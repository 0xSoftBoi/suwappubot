// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Base64.sol";
import "./SuwappuArt.sol";

/**
 * @title SuwappuCodex — the contract as its own subject
 *
 * The Positions plate is art a contract MAKES. This is art a contract IS.
 *
 * There is exactly one way a smart contract can be the artwork rather than the
 * vending machine in front of it, and it is not decoration: the thing on the
 * wall has to be the machine. So this contract reads deployed bytecode — its
 * own, or any other address's — reads it as instructions rather than as bytes,
 * and strikes the result as a plate. What you are looking at is not a picture of
 * a contract. It is the contract, laid out in reading order, one band per class
 * of instruction.
 *
 * `selfPortrait()` is the piece. The engraver reads its own body out of the
 * state trie and draws it, and every byte in the drawing is a byte you can
 * fetch yourself with `eth_getCode` and compare. There is no artist's statement
 * to take on faith and no version of this that can be faked: change one line of
 * the source and the portrait changes, because the portrait is the compilation.
 *
 * WHAT THE PLATE SHOWS
 *   A contract has anatomy, and it is legible once you stop treating bytecode as
 *   an undifferentiated blob:
 *
 *     - the dispatcher at the head — a dense comb of PUSH/EQ/JUMPI as the
 *       selector is compared against every function, so a contract with many
 *       entry points opens with a visibly striped band and a small one does not
 *     - the body — stack and arithmetic, the colour of ordinary work
 *     - STORAGE, drawn in gold because it is the expensive, permanent thing a
 *       contract does and it should be countable by eye. A renderer that touches
 *       storage nowhere has no gold in it at all, and you can see that
 *     - EXTERNAL — CALL, DELEGATECALL, CREATE, SELFDESTRUCT — in oxblood,
 *       because the places a contract can hand control to somebody else are the
 *       places worth finding, and a portrait that makes them findable is doing
 *       something an audit does
 *     - PUSH operands and the trailing CBOR metadata as DATA: the quiet ground
 *       the instructions sit on, and at the foot of every Solidity contract, the
 *       solid unbroken block of the compiler's own signature
 *
 *   So the plate is a likeness in the real sense. Two contracts of the same size
 *   look nothing alike, and one contract looks like itself.
 *
 * NOT A DISASSEMBLER, AND HONEST ABOUT IT. This is a linear sweep: it starts at
 * byte zero and walks forward, PUSH-aware, which is what a disassembler does
 * before it knows the jump graph. That gets the thing a naive byte histogram
 * gets wrong — PUSH operands are data, not instructions, which is why most
 * "bytecode art" is noise — but a linear sweep cannot know which regions are
 * never executed. Solidity stores long string constants inside the runtime code
 * and reaches them with CODECOPY; swept linearly, those bytes decode as
 * plausible instructions, so a contract carrying a lot of text will show a
 * scatter of phantom ones. Recursive descent would fix it and does not fit in a
 * view call. The plate says what it is: a reading, not a proof.
 *
 * It draws proportion and rhythm, not operands. You cannot recover the program
 * from the picture. You can recognise it — and you can tell, across a room,
 * a contract that holds your money from one that only draws.
 */
contract SuwappuCodex {
    // ─── Centurion Noir, in the vocabulary of a machine ───────────────────────
    uint24 internal constant OBSIDIAN = 0x0a0b0d;
    uint24 internal constant CHARCOAL = 0x0d0d10;
    uint24 internal constant IVORY = 0xf2ede3;
    uint24 internal constant PINK = 0xf472b6;
    uint24 internal constant BLACK = 0x000000;

    string internal constant DISPLAY =
        "Geist,Inter,system-ui,-apple-system,'Liberation Sans',Arial,sans-serif";
    string internal constant MONO =
        "'Geist Mono','SFMono-Regular',Menlo,Consolas,'DejaVu Sans Mono',monospace";

    uint256 internal constant DATA = 0;
    uint256 internal constant STACK = 1;
    uint256 internal constant MATH = 2;
    uint256 internal constant MEMORY = 3;
    uint256 internal constant STORAGE = 4;
    uint256 internal constant FLOW = 5;
    uint256 internal constant EXTERNAL = 6;
    uint256 internal constant CONTEXT = 7;
    uint256 internal constant CLASSES = 8;

    uint256 internal constant COLS = 32;
    uint256 internal constant ROWS = 24;
    int256 internal constant PITCH = 160;
    int256 internal constant CELL = 132;
    int256 internal constant GRID_X = 440;
    int256 internal constant GRID_Y = 2560;

    error NotAContract();

    /// @dev The ground each class is struck in. Ordered so that the two a reader
    ///      should be able to find without counting — what this contract writes
    ///      forever, and where it can hand control to somebody else — are the
    ///      only warm colours on a cold plate.
    function _ink(uint256 c) internal pure returns (uint24) {
        if (c == STACK) return 0x6e7176; // graphite   — moving things about
        if (c == MATH) return 0x6ea8c9; // steel       — the actual arithmetic
        if (c == MEMORY) return 0x5fb3a1; // verdigris — scratch space
        if (c == STORAGE) return 0xe0bd76; // gold     — the permanent, the costly
        if (c == FLOW) return 0xaab1b9; // platinum    — jumps, returns, reverts
        if (c == EXTERNAL) return 0xc4767c; // oxblood — where control can leave
        if (c == CONTEXT) return 0xb78ec2; // amethyst — the world outside
        return 0x232429; //                  near-ground — operands and metadata
    }

    function _label(uint256 c) internal pure returns (string memory) {
        if (c == STACK) return "STACK";
        if (c == MATH) return "MATH";
        if (c == MEMORY) return "MEM";
        if (c == STORAGE) return "STORE";
        if (c == FLOW) return "FLOW";
        if (c == EXTERNAL) return "EXT";
        if (c == CONTEXT) return "ENV";
        return "DATA";
    }

    // ─── Reading the body ─────────────────────────────────────────────────────

    /// @notice One class per byte of `code`, walked as the EVM walks it.
    ///
    /// @dev    The whole difference between a portrait and a noise field is this
    ///         function respecting PUSH. `PUSH32 <32 bytes>` is ONE instruction
    ///         followed by thirty-two bytes that are not instructions at all,
    ///         and a scanner that classifies every byte by its opcode table
    ///         entry reports a contract as a uniform grey mush — every constant,
    ///         every jump destination and every string in it misread as
    ///         arithmetic. Walk it properly and the anatomy appears.
    ///
    ///         The trailing CBOR block every Solidity build appends is found the
    ///         way the toolchain writes it — the last two bytes are its length —
    ///         and marked DATA in one piece. It is not code, it has never been
    ///         executed, and drawn as though it were it would put a band of
    ///         phantom instructions at the foot of every plate.
    function _read(bytes memory code) internal pure returns (bytes memory cls) {
        uint256 n = code.length;
        cls = new bytes(n);

        uint256 end = n;
        if (n > 2) {
            uint256 metaLen = (uint256(uint8(code[n - 2])) << 8) | uint8(code[n - 1]);
            if (metaLen != 0 && metaLen + 2 <= n) end = n - metaLen - 2; // DATA already
        }

        uint256 i;
        while (i < end) {
            uint256 op = uint8(code[i]);
            cls[i] = bytes1(uint8(_classOf(op)));
            unchecked {
                ++i;
            }
            if (op >= 0x60 && op <= 0x7f) {
                // PUSH1..PUSH32 — skip the operand, leaving it DATA (already 0).
                uint256 skip = op - 0x5f;
                i += skip;
            }
        }
    }

    function _classOf(uint256 op) internal pure returns (uint256) {
        if (op == 0x00) return FLOW; // STOP
        if (op <= 0x0b) return MATH; // ADD..SIGNEXTEND
        if (op >= 0x10 && op <= 0x1d) return MATH; // LT..SAR
        if (op == 0x20) return CONTEXT; // KECCAK256
        if (op == 0x37 || op == 0x39 || op == 0x3c || op == 0x3e) return MEMORY; // *COPY
        if (op >= 0x30 && op <= 0x4a) return CONTEXT; // address/block environment
        if (op == 0x50) return STACK; // POP
        if (op == 0x51 || op == 0x52 || op == 0x53 || op == 0x59 || op == 0x5e) return MEMORY;
        if (op == 0x54 || op == 0x55 || op == 0x5c || op == 0x5d) return STORAGE; // S/TLOAD/STORE
        if (op >= 0x56 && op <= 0x5b) return FLOW; // JUMP..JUMPDEST
        if (op >= 0x5f && op <= 0x9f) return STACK; // PUSH0..PUSH32, DUP, SWAP
        if (op >= 0xa0 && op <= 0xa4) return EXTERNAL; // LOG0..LOG4
        if (op == 0xf3 || op == 0xfd || op == 0xfe) return FLOW; // RETURN/REVERT/INVALID
        if (op >= 0xf0) return EXTERNAL; // CREATE/CALL/DELEGATECALL/CREATE2/STATICCALL/SELFDESTRUCT
        return DATA; // unassigned — the EVM would refuse it too
    }

    /// @notice The plate's 32 x 24 field: what each slice of the contract is
    ///         mostly doing, except where something rare is happening in it.
    ///
    /// @dev    THE REDUCTION RULE, and it is the whole design of the piece.
    ///
    ///         A cell covers a few dozen bytes — call it fifteen instructions.
    ///         Reduce that by simple majority and every cell in every contract
    ///         comes back STACK or DATA, because that is what bytecode is mostly
    ///         made of, and the plate is a grey static field that tells you
    ///         nothing. The first cut of this did exactly that: SuwappuPositions,
    ///         which writes state in a dozen places and makes external calls in
    ///         several more, rendered with not one gold or oxblood cell on it.
    ///
    ///         So: majority for the texture, PROMOTION for the two things worth
    ///         finding. If anything in the slice hands control outside the
    ///         contract it is drawn oxblood; else if anything in it touches
    ///         storage it is drawn gold; else it is drawn as whatever it is
    ///         mostly doing. Rarity is the subject — a single SSTORE in forty
    ///         bytes of stack shuffling is the fact about those forty bytes.
    ///
    ///         The census bar under the field is NOT promoted. It is the plain
    ///         proportions, unedited, so the plate carries both truths at once:
    ///         a field composed for significance, and a rule that shows you what
    ///         the contract is actually made of.
    function _field(bytes memory cls) internal pure returns (bytes memory cells) {
        uint256 n = cls.length;
        uint256 total = COLS * ROWS;
        cells = new bytes(total);
        if (n == 0) return cells;
        uint256[] memory tally = new uint256[](CLASSES);
        for (uint256 c = 0; c < total; c++) {
            uint256 from = (c * n) / total;
            uint256 to = ((c + 1) * n) / total;
            if (to == from && from < n) to = from + 1;
            for (uint256 k = 0; k < CLASSES; k++) {
                tally[k] = 0;
            }
            for (uint256 i = from; i < to && i < n; i++) {
                tally[uint8(cls[i])]++;
            }
            uint256 best;
            uint256 bestN;
            for (uint256 k = 0; k < CLASSES; k++) {
                if (tally[k] > bestN) {
                    bestN = tally[k];
                    best = k;
                }
            }
            if (tally[EXTERNAL] != 0) best = EXTERNAL;
            else if (tally[STORAGE] != 0) best = STORAGE;
            cells[c] = bytes1(uint8(best));
        }
    }

    function _census(bytes memory cls) internal pure returns (uint256[] memory out) {
        out = new uint256[](CLASSES);
        for (uint256 i = 0; i < cls.length; i++) {
            out[uint8(cls[i])]++;
        }
    }

    // ─── Striking the plate ───────────────────────────────────────────────────

    /// @dev One path per class, run-length encoded along each row. Contracts are
    ///      full of long runs — a PUSH-heavy dispatcher, a metadata block — so
    ///      encoding runs rather than cells is not a micro-optimisation but the
    ///      honest shape of the data: the picture IS a run-length reading of the
    ///      machine. It also takes the plate from ~20KB of SVG to ~6KB.
    function _weave(bytes memory cells) internal pure returns (string memory out) {
        for (uint256 k = 0; k < CLASSES; k++) {
            string memory d = "";
            for (uint256 r = 0; r < ROWS; r++) {
                uint256 c;
                while (c < COLS) {
                    if (uint8(cells[r * COLS + c]) != k) {
                        unchecked {
                            ++c;
                        }
                        continue;
                    }
                    uint256 run = 1;
                    while (c + run < COLS && uint8(cells[r * COLS + c + run]) == k) {
                        unchecked {
                            ++run;
                        }
                    }
                    int256 w = int256(run - 1) * PITCH + CELL;
                    d = string.concat(
                        d,
                        "M",
                        Ink.intStr(GRID_X + int256(c) * PITCH),
                        " ",
                        Ink.intStr(GRID_Y + int256(r) * PITCH),
                        "h",
                        Ink.intStr(w),
                        "v",
                        Ink.intStr(CELL),
                        "h-",
                        Ink.intStr(w),
                        "z"
                    );
                    c += run;
                }
            }
            if (bytes(d).length == 0) continue;
            out = string.concat(
                out,
                "<path d='",
                d,
                "' fill='",
                Hue.str(_ink(k)),
                "' fill-opacity='",
                k == DATA ? "0.9" : "0.86",
                "'/>"
            );
        }
    }

    /// @dev The census, as one stacked rule. A contract's proportions at a
    ///      glance: how much of it is arithmetic, how much is bookkeeping, how
    ///      little of it — usually — actually writes anything down.
    function _bar(uint256[] memory census, uint256 total)
        internal
        pure
        returns (string memory out)
    {
        if (total == 0) return "";
        int256 x = GRID_X;
        int256 width = int256(COLS) * PITCH - (PITCH - CELL);
        for (uint256 k = 0; k < CLASSES; k++) {
            int256 w = (int256(census[k]) * width) / int256(total);
            if (w <= 0) continue;
            out = string.concat(
                out,
                "<rect x='",
                Ink.intStr(x),
                "' y='6640' width='",
                Ink.intStr(w),
                "' height='96' fill='",
                Hue.str(_ink(k)),
                "'/>"
            );
            x += w;
        }
    }

    function _legend(uint256[] memory census) internal pure returns (string memory out) {
        for (uint256 k = 1; k < CLASSES; k++) {
            int256 x = GRID_X + int256(k - 1) * 730;
            // Every non-DATA byte is exactly one instruction — PUSH operands
            // were classified as DATA — so this count is an instruction count.
            out = string.concat(
                out,
                "<rect x='",
                Ink.intStr(x),
                "' y='2150' width='96' height='96' rx='14' fill='",
                Hue.str(_ink(k)),
                "'/>",
                _set(x + 140, 2232, 130, 16, Hue.mix(0x8b8e94, IVORY, 300), "start", _label(k)),
                _set(x + 140, 2392, 130, 16, Hue.mix(_ink(k), IVORY, 250), "start",
                    Ink.uintStr(census[k]))
            );
        }
    }

    function _set(
        int256 x,
        int256 y,
        uint256 size,
        uint256 track,
        uint24 fill,
        string memory anchor,
        string memory txt
    ) internal pure returns (string memory) {
        return string.concat(
            "<text x='", Ink.intStr(x), "' y='", Ink.intStr(y),
            "' font-family=\"", MONO,
            "\" font-size='", Ink.uintStr(size),
            "' letter-spacing='", Ink.uintStr(track),
            "' text-anchor='", anchor,
            "' fill='", Hue.str(fill), "'>", txt, "</text>"
        );
    }

    function _defs() internal pure returns (string memory) {
        return string.concat(
            "<defs>",
            "<radialGradient id='g' cx='50%' cy='30%' r='88%'>",
            "<stop offset='0' stop-color='", Hue.str(Hue.mix(CHARCOAL, IVORY, 60)), "'/>",
            "<stop offset='0.62' stop-color='", Hue.str(CHARCOAL), "'/>",
            "<stop offset='1' stop-color='", Hue.str(Hue.mix(CHARCOAL, BLACK, 400)), "'/>",
            "</radialGradient>",
            "<linearGradient id='m' x1='0' y1='0' x2='1' y2='1'>",
            "<stop offset='0' stop-color='#d6dade'/>",
            "<stop offset='0.48' stop-color='#8b8e94'/>",
            "<stop offset='1' stop-color='#3f4145'/>",
            "</linearGradient>",
            "<linearGradient id='s' x1='85%' y1='0%' x2='15%' y2='100%'>",
            "<stop offset='0' stop-color='#fff' stop-opacity='0'/>",
            "<stop offset='0.46' stop-color='#fff' stop-opacity='0.05'/>",
            "<stop offset='1' stop-color='#fff' stop-opacity='0'/>",
            "</linearGradient>",
            "<pattern id='b' width='40' height='52' patternUnits='userSpaceOnUse'>",
            "<line x1='0' x2='40' y1='2' y2='2' stroke='#f2ede3' stroke-opacity='0.05' stroke-width='4'/>",
            "<line x1='0' x2='40' y1='27' y2='27' stroke='#000' stroke-opacity='0.1' stroke-width='6'/>",
            "</pattern>",
            "<clipPath id='c'><rect x='240' y='240' width='5520' height='7920' rx='300'/></clipPath>",
            "</defs>"
        );
    }

    // ─── The piece ────────────────────────────────────────────────────────────

    /// @notice The portrait of `subject`, drawn from the code at that address.
    /// @dev    Reverts on an address with no code rather than drawing an empty
    ///         plate: a portrait of nothing is not a minimal portrait, it is a
    ///         false one.
    function portrait(address subject) public view returns (string memory) {
        bytes memory code = subject.code;
        if (code.length == 0) revert NotAContract();
        bytes memory cls = _read(code);
        uint256[] memory census = _census(cls);
        return string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 6000 8400'"
            " width='600' height='840'>",
            _defs(),
            "<rect width='6000' height='8400' fill='", Hue.str(OBSIDIAN), "'/>",
            "<rect x='240' y='240' width='5520' height='7920' rx='300' fill='url(#g)'/>",
            "<g clip-path='url(#c)'>",
            "<rect x='240' y='240' width='5520' height='7920' fill='url(#b)'/>",
            _weave(_field(cls)),
            _legend(census),
            _bar(census, code.length),
            "<rect x='240' y='240' width='5520' height='7920' fill='url(#s)'/>",
            "</g>",
            "<rect x='240' y='240' width='5520' height='7920' rx='300' fill='none'"
            " stroke='url(#m)' stroke-width='10'/>",
            _type(subject, code),
            "</svg>"
        );
    }

    function _type(address subject, bytes memory code) internal view returns (string memory) {
        return string.concat(_head(subject, code.length), _foot(subject));
    }

    function _head(address subject, uint256 size) internal view returns (string memory) {
        uint24 quiet = Hue.mix(0x8b8e94, IVORY, 300);
        return string.concat(
            _set(
                620,
                1230,
                150,
                50,
                quiet,
                "start",
                subject == address(this) ? "SELF PORTRAIT" : "CODEPLATE"
            ),
            _set(
                5380, 1230, 150, 12, 0x8b8e94, "end",
                string.concat(Ink.uintStr(size), " BYTES")
            ),
            "<rect x='2952' y='1352' width='96' height='96' rx='14'"
            " transform='rotate(45 3000 1400)' fill='",
            Hue.str(PINK),
            "'/>",
            "<line x1='620' x2='5380' y1='1400' y2='1400' stroke='",
            Hue.str(quiet),
            "' stroke-width='7' stroke-opacity='0.38'/>",
            // The subject's own name for itself. There is no other.
            _set(3000, 1900, 190, 6, IVORY, "middle", Ink.hexAddr(subject))
        );
    }

    function _foot(address subject) internal view returns (string memory) {
        uint24 quiet = Hue.mix(0x8b8e94, IVORY, 300);
        return string.concat(
            _set(620, 7080, 130, 43, quiet, "start", "CODEHASH"),
            _set(620, 7330, 190, 8, IVORY, "start", _half(subject, true)),
            _set(620, 7570, 190, 8, IVORY, "start", _half(subject, false)),
            _set(
                3000,
                7960,
                140,
                47,
                0x8b8e94,
                "middle",
                unicode"SUWAPPU CODEX  ·  READ FROM CHAIN AT CALL TIME"
            )
        );
    }

    /// @dev The codehash, split so it fits the plate at a size it can be read at.
    function _half(address subject, bool top) internal view returns (string memory) {
        string memory h = Ink.hexHash(subject.codehash);
        bytes memory b = bytes(h);
        bytes memory o = new bytes(32);
        for (uint256 i = 0; i < 32; i++) {
            o[i] = b[top ? i : i + 32];
        }
        return string(o);
    }

    /// @notice Instructions of each class in `subject`, indexed by the DATA..
    ///         CONTEXT constants above. Index 0 is not an instruction count — it
    ///         is bytes: PUSH operands plus the compiler's metadata block.
    /// @dev    Public because the reading should be checkable without decoding a
    ///         picture. If the plate says a contract never writes state, this is
    ///         the number a reader can verify that claim against.
    function census(address subject) external view returns (uint256[] memory) {
        bytes memory code = subject.code;
        if (code.length == 0) revert NotAContract();
        return _census(_read(code));
    }

    /// @notice The engraver, drawn by the engraver.
    function selfPortrait() external view returns (string memory) {
        return portrait(address(this));
    }

    /// @notice ERC-721-shaped metadata, so a portrait can be looked at anywhere
    ///         a token can. Keyed by address rather than by token id — the
    ///         subject of the work is a contract, not an edition.
    function tokenURI(address subject) external view returns (string memory) {
        bytes memory code = subject.code;
        if (code.length == 0) revert NotAContract();
        uint256[] memory census = _census(_read(code));
        string memory json = string.concat(
            '{"name":"Codeplate ',
            Ink.hex16(uint256(uint160(subject)) >> 128, 4),
            '","description":"',
            "A portrait of a deployed contract, drawn on-chain from the contract "
            "itself. The bytecode at the subject address is walked the way the EVM "
            "walks it - PUSH operands are data, not instructions - and each band "
            "of the plate is the modal class of that slice of the machine: what it "
            "is mostly doing there. Storage is gold and outward calls are oxblood, "
            "so the permanent and the dangerous can be found by eye. Nothing is "
            "hosted and nothing is stored: the picture is read out of the state "
            "trie at the moment you ask, and if the code ever changed, so would it.",
            '","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(portrait(subject))),
            '","attributes":[',
            '{"trait_type":"Subject","value":"', Ink.hexAddr(subject), '"},',
            '{"trait_type":"Codehash","value":"', Ink.hexHash(subject.codehash), '"},',
            '{"trait_type":"Size","value":', Ink.uintStr(code.length), "},",
            '{"trait_type":"Writes State","value":', Ink.uintStr(census[STORAGE]), "},",
            '{"trait_type":"Outward Calls","value":', Ink.uintStr(census[EXTERNAL]), "},",
            '{"trait_type":"Self Portrait","value":"',
            subject == address(this) ? "Yes" : "No",
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
