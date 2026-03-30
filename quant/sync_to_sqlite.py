import json
import sqlite3
import pandas as pd
from datetime import datetime
import os

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(BASE_DIR, 'data', 'feature_log.json')
DB_PATH = os.path.join(BASE_DIR, 'quant', 'adan_data.db')

def sync_json_to_sqlite():
    print(f"Reading {JSON_PATH}...")
    try:
        with open(JSON_PATH, 'r') as f:
            data = json.load(f)
    except FileNotFoundError:
        print("feature_log.json not found. Make sure ADAN has logged some features.")
        return

    # Flatten the JSON structure for relational database
    flat_data = []
    for entry in data:
        # Check if the trade is resolved (we only want resolved trades for training)
        # But we also want unresolved to predict on. Let's save all.
        features = entry.get('features', {})
        
        # Handle complex objects like fundingRate
        funding_rate = features.get('fundingRate', {})
        if isinstance(funding_rate, dict):
            f_rate = funding_rate.get('rate', 0)
        else:
            f_rate = funding_rate
            
        row = {
            'trade_id': entry.get('id'),
            'timestamp': entry.get('timestamp'),
            'asset': features.get('asset'),
            'fear_greed': features.get('fearGreed'),
            'funding_rate': f_rate,
            'trend_strength': features.get('trendStrength'),
            'vol_ratio': features.get('volRatio'),
            'utc_hour': features.get('utcHour'),
            'edge': features.get('edge'),
            'llm_confidence': features.get('confidence'),
            'resolved': 1 if entry.get('resolved') else 0,
            'won': 1 if entry.get('won') is True else (0 if entry.get('won') is False else None),
        }
        flat_data.append(row)

    df = pd.DataFrame(flat_data)
    
    # Convert timestamp to datetime
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    print(f"Loaded {len(df)} rows. Syncing to SQLite {DB_PATH}...")
    
    # Connect to SQLite (creates the file if it doesn't exist)
    conn = sqlite3.connect(DB_PATH)
    
    # Save to database (replace overwrites the table so it's fresh every time we sync)
    df.to_sql('features', conn, if_exists='replace', index=False)
    
    conn.close()
    print("✅ Sync complete. Database is ready for Jupyter Notebooks.")

if __name__ == "__main__":
    sync_json_to_sqlite()
