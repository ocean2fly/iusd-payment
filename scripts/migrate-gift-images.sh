#!/usr/bin/env bash
# Migrate gift box images from external URLs to local static hosting.
#
# 1. Reads all image URLs from gift_box_meta DB
# 2. Downloads each image to /ipay-deploy/frontend/images/gifts/
# 3. Updates DB image_urls to point to https://iusd-pay.xyz/images/gifts/
#
# Usage: bash scripts/migrate-gift-images.sh
#
# Prerequisites: curl, jq, psql

set -euo pipefail

API_BASE="https://api.iusd-pay.xyz/v1"
DEPLOY_DIR="/home/jack_initia_xyz/ipay-deploy/frontend/images/gifts"
PUBLIC_URL="https://iusd-pay.xyz/images/gifts"
DB_PATH="/home/jack_initia_xyz/ipay-deploy/repo/packages/api"

mkdir -p "$DEPLOY_DIR"

echo "▶ Fetching gift configs..."
CONFIGS=$(curl -s "$API_BASE/gift/configs")
COUNT=$(echo "$CONFIGS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('configs',[])))")
echo "  Found $COUNT gift boxes"

echo "▶ Downloading images..."
echo "$CONFIGS" | python3 -c "
import sys, json, os, subprocess, hashlib

configs = json.load(sys.stdin).get('configs', [])
deploy_dir = '$DEPLOY_DIR'
public_url = '$PUBLIC_URL'
updates = []

for c in configs:
    box_id = c.get('giftId', c.get('box_id'))
    urls = c.get('imageUrls', [])
    if not urls and c.get('thumbUrl'):
        urls = [c['thumbUrl']]

    new_urls = []
    for i, url in enumerate(urls):
        if not url or url.startswith(public_url):
            new_urls.append(url)
            continue

        # Generate filename from box_id + index + extension
        ext = url.split('.')[-1].split('?')[0][:4]
        if ext not in ('jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'):
            ext = 'jpg'
        filename = f'box_{box_id}_{i}.{ext}'
        filepath = os.path.join(deploy_dir, filename)

        if not os.path.exists(filepath):
            print(f'  Downloading box {box_id} img {i}: {url[:60]}...')
            result = subprocess.run(
                ['curl', '-sL', '-o', filepath, '--max-time', '30', url],
                capture_output=True
            )
            if result.returncode != 0 or not os.path.exists(filepath) or os.path.getsize(filepath) < 100:
                print(f'  ⚠ Failed: {url[:60]}')
                new_urls.append(url)  # keep original
                continue
        else:
            print(f'  Already exists: {filename}')

        new_urls.append(f'{public_url}/{filename}')

    if new_urls != urls:
        updates.append((box_id, new_urls))

print(f'\n▶ {len(updates)} boxes need DB update')
for box_id, new_urls in updates:
    print(f'  Box {box_id}: {json.dumps(new_urls)[:100]}')

# Write update SQL
with open('/tmp/gift_image_updates.json', 'w') as f:
    json.dump(updates, f)
"

echo ""
echo "▶ Images downloaded to: $DEPLOY_DIR"
echo "  Public URL: $PUBLIC_URL/"
ls -la "$DEPLOY_DIR/" | head -30

echo ""
echo "▶ To update DB, run:"
echo "  python3 scripts/apply-gift-image-urls.py"
