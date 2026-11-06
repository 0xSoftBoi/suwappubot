import urllib.request, sys, os
R = sys.argv[1]; ver = sys.argv[2]
base = 'https://raw.' + 'githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v%s/contracts/' % ver
for f in ['utils/math/Math.sol', 'utils/math/SafeCast.sol', 'utils/math/SignedMath.sol', 'utils/Panic.sol', 'utils/ReentrancyGuard.sol', 'token/ERC20/utils/SafeERC20.sol', 'token/ERC20/IERC20.sol']:
    d = urllib.request.urlopen(base + f).read()
    p = R + '/proj/lib/openzeppelin-contracts/contracts/' + f
    os.makedirs(os.path.dirname(p), exist_ok=True)
    old = open(p, 'rb').read() if os.path.exists(p) else None
    print(f, len(d), 'same-as-verified' if old == d else ('DIFFERS' if old else 'new'))
    if old is None: open(p, 'wb').write(d)
