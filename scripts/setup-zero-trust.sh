#!/bin/bash
# iPay Zero Trust Setup Script
# 
# Prerequisites:
# 1. Create API token at https://dash.cloudflare.com/profile/api-tokens
#    - Permissions: Account > Access: Organizations, Identity Providers, and Groups > Edit
#    - Permissions: Account > Access: Apps and Policies > Edit
# 2. Export the token: export CF_API_TOKEN="your_token_here"

set -e

ACCOUNT_ID="5feadc589fc77df4dc96cb23b3e98083"
ZONE_NAME="iusd-pay.xyz"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}iPay Zero Trust Setup${NC}"
echo "======================================"

# Check for API token
if [ -z "$CF_API_TOKEN" ]; then
    echo -e "${RED}Error: CF_API_TOKEN not set${NC}"
    echo ""
    echo "1. Go to: https://dash.cloudflare.com/profile/api-tokens"
    echo "2. Create token with Access permissions"
    echo "3. Run: export CF_API_TOKEN='your_token'"
    echo "4. Run this script again"
    exit 1
fi

# Verify token
echo "Verifying API token..."
VERIFY=$(curl -s -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json")

if echo "$VERIFY" | grep -q '"success":true'; then
    echo -e "${GREEN}✓ Token verified${NC}"
else
    echo -e "${RED}✗ Token invalid${NC}"
    echo "$VERIFY"
    exit 1
fi

# Get Zone ID
echo "Getting Zone ID for $ZONE_NAME..."
ZONE_RESPONSE=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=$ZONE_NAME" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json")

ZONE_ID=$(echo "$ZONE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$ZONE_ID" ]; then
    echo -e "${RED}✗ Could not find zone${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Zone ID: $ZONE_ID${NC}"

# Function to create Access Application
create_app() {
    local name=$1
    local domain=$2
    local path=$3
    
    echo "Creating Access Application: $name ($domain$path)..."
    
    APP_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data "{
            \"name\": \"$name\",
            \"domain\": \"$domain$path\",
            \"type\": \"self_hosted\",
            \"session_duration\": \"24h\",
            \"auto_redirect_to_identity\": true
        }")
    
    APP_ID=$(echo "$APP_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -z "$APP_ID" ]; then
        echo -e "${YELLOW}⚠ App may already exist or failed${NC}"
        echo "$APP_RESPONSE" | head -c 200
        echo ""
        return
    fi
    
    echo -e "${GREEN}✓ Created app: $APP_ID${NC}"
    
    # Create allow policy
    echo "  Creating access policy..."
    POLICY_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data '{
            "name": "Allow Admin",
            "decision": "allow",
            "include": [
                {
                    "email_domain": {
                        "domain": "gmail.com"
                    }
                }
            ],
            "precedence": 1
        }')
    
    if echo "$POLICY_RESPONSE" | grep -q '"success":true'; then
        echo -e "${GREEN}  ✓ Policy created${NC}"
    else
        echo -e "${YELLOW}  ⚠ Policy may need manual config${NC}"
    fi
}

echo ""
echo "Creating Access Applications..."
echo ""

# Admin - highest priority
create_app "iPay Admin" "admin.iusd-pay.xyz" ""

# Main app
create_app "iPay App" "iusd-pay.xyz" ""
create_app "iPay App (www)" "www.iusd-pay.xyz" ""
create_app "iPay App (app)" "app.iusd-pay.xyz" ""

# API (optional - might need different handling for programmatic access)
# create_app "iPay API" "api.iusd-pay.xyz" ""

echo ""
echo -e "${GREEN}======================================"
echo "Setup complete!"
echo "======================================${NC}"
echo ""
echo "Next steps:"
echo "1. Go to https://one.dash.cloudflare.com"
echo "2. Navigate to Access > Applications"
echo "3. Verify the applications were created"
echo "4. Update policies with your specific email addresses"
echo ""
echo "To add specific emails, update the policy 'include' to:"
echo '  "include": [{"email": {"email": "your@email.com"}}]'
