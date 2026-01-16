from eth_account import Account

account = Account.create()
tx = {
    "to": account.address,
    "value": 100,
    "gas": 21000,
    "gasPrice": 10**9,
    "nonce": 0,
    "chainId": 1
}
signed = Account.sign_transaction(tx, account.key)
print(f"Signed types: {type(signed)}")
print(f"Dir signed: {dir(signed)}")
print(f"Raw Hex: {signed.rawTransaction.hex()}")

# Check what WalletService does
from bot.services.wallet import WalletService
ws = WalletService()
# Mock decrypt just for this test
from unittest.mock import patch
with patch('bot.services.wallet.decrypt_private_key', return_value=account.key.hex()):
    res = ws.sign_evm_transaction_raw("encrypted", tx)
    print(f"WalletService result: {type(res)}")
    print(f"Result: {res}")
