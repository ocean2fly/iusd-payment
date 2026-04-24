#!/usr/bin/env python3
"""
Apply migrated gift image URLs to the database.
Reads /tmp/gift_image_updates.json (from migrate-gift-images.sh)
and updates gift_box_meta.image_urls for each box.
"""
import json
import sys
import os

PG_URL = os.environ.get('DATABASE_URL', '')

updates_file = '/tmp/gift_image_updates.json'
if not os.path.exists(updates_file):
    print('No updates file found. Run migrate-gift-images.sh first.')
    sys.exit(1)

with open(updates_file) as f:
    updates = json.load(f)

if not updates:
    print('No updates needed.')
    sys.exit(0)

print(f'Applying {len(updates)} image URL updates...')

if not PG_URL:
    print('DATABASE_URL not set.')
    sys.exit(1)

import psycopg2
conn = psycopg2.connect(PG_URL)
cur = conn.cursor()
for box_id, new_urls in updates:
    cur.execute(
        'UPDATE gift_box_meta SET image_urls = %s, updated_at = NOW() WHERE box_id = %s',
        (json.dumps(new_urls), box_id)
    )
    print(f'  Updated box {box_id}: {len(new_urls)} images')
conn.commit()
cur.close()
conn.close()

print('Done.')
