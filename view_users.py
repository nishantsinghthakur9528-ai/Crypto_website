#!/usr/bin/env python3
"""
CryptoTop - Database User Inspector
Usage: python view_users.py
"""
import sqlite3
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "cryptotop.db")

def main():
    if not os.path.exists(DB_PATH):
        print(f"[ERROR] Database file not found at: {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    try:
        c.execute("""
            SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.birth_date,
                   u.kyc_status, u.password_hash, u.salt, u.created_at,
                   COALESCE(w.balance, 0.0) as balance,
                   COALESCE(w.locked, 0.0) as locked
            FROM users u
            LEFT JOIN wallets w ON u.id = w.user_id
            ORDER BY u.created_at DESC
        """)
        users = c.fetchall()

        print("=" * 80)
        print(f"  CRYPTOTOP USER DATABASE ({len(users)} Total Registered Accounts)")
        print("=" * 80)

        if not users:
            print("No users found in database.")
            return

        for idx, u in enumerate(users, 1):
            name = f"{u['first_name'] or ''} {u['last_name'] or ''}".strip() or "N/A"
            print(f"[{idx}] User ID:       {u['id']}")
            print(f"    Email:         {u['email']}")
            print(f"    Name:          {name}")
            print(f"    Phone:         {u['phone'] or 'N/A'}")
            print(f"    Birth Date:    {u['birth_date'] or 'N/A'}")
            print(f"    KYC Status:    {u['kyc_status'] or 'UNVERIFIED'}")
            print(f"    Spot Balance:  ${float(u['balance']):,.2f} USDT (Locked: ${float(u['locked']):,.2f})")
            print(f"    Registered:    {u['created_at']}")
            print(f"    Password Salt: {u['salt']}")
            print(f"    Pass Hash:     {u['password_hash']}")
            print("    Security Note: Passwords are encrypted using SHA-256 with unique salt.")
            print("-" * 80)

    except Exception as e:
        print(f"[ERROR] Could not query database: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
