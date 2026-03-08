from web3 import Web3

w3 = Web3()
abi = [{"constant": False, "inputs": [{"name": "_to", "type": "address"}, {"name": "_value", "type": "uint256"}], "name": "transfer", "outputs": [{"name": "", "type": "bool"}], "type": "function"}]
c = w3.eth.contract(address="0x0000000000000000000000000000000000000000", abi=abi)
func = c.functions.transfer("0x0000000000000000000000000000000000000000", 123)
print(f"Function object: {func}")
print(f"Dir: {dir(func)}")
try:
    print(f"Encoded: {func._encode_transaction_data()}")
except Exception as e:
    print(f"Error: {e}")
