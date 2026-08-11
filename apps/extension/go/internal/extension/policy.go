package extension

import (
	"math/big"

	"policy-extension/internal/config"
	"policy-extension/pkg/types"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// The third implementation of the commitment, after TypeScript (packages/policy)
// and Solidity (ConfidentialPolicy). All three must agree exactly, so all three
// are asserted against packages/policy/fixtures/commitment-vectors.json. If you
// change an encoding here, regenerate those vectors and expect the other two
// suites to fail -- that failure is the safety net working.

var (
	// keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
	eip712DomainTypehash = crypto.Keccak256(
		[]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
	)

	// Mirrors SHARE_TYPEHASH in ConfidentialPolicy.sol.
	shareTypehash = crypto.Keccak256([]byte("Share(address recipient,uint16 shareBps)"))

	// Mirrors EXECUTION_TYPEHASH in ConfidentialPolicy.sol.
	executionTypehash = crypto.Keccak256(
		[]byte("Execution(bytes32 commitment,bytes32 sharesHash,uint256 triggeredAt)"),
	)
)

// computeCommitment reproduces keccak256(abi.encode(Share[], bytes32)).
//
// Layout of abi.encode with one dynamic array and one static value:
//
//	word 0  offset to the array data, which is 0x40 -- two head words precede it
//	word 1  salt
//	word 2  array length
//	word 3+ each element inline, since Share is a *static* tuple
//
// shareBps is uint16 in Solidity but every ABI word is padded to 32 bytes, so the
// bytes are identical to the uint256 the TypeScript encoder emits. That is why the
// shared vectors match despite the type difference.
func computeCommitment(shares []types.Share, salt common.Hash) common.Hash {
	buf := make([]byte, 0, 96+len(shares)*64)

	buf = append(buf, padUint(big.NewInt(0x40))...)
	buf = append(buf, salt.Bytes()...)
	buf = append(buf, padUint(big.NewInt(int64(len(shares))))...)

	for _, s := range shares {
		buf = append(buf, common.LeftPadBytes(s.Recipient.Bytes(), 32)...)
		buf = append(buf, padUint(new(big.Int).SetUint64(uint64(s.ShareBps)))...)
	}

	return common.BytesToHash(crypto.Keccak256(buf))
}

// hashShares reproduces ConfidentialPolicy._hashShares: each element hashed as an
// EIP-712 struct, then the concatenation hashed. Note the inner hash uses
// abi.encode (padded) while the outer uses abi.encodePacked (tight) -- mixing the
// two is exactly the kind of detail that silently breaks recovery.
func hashShares(shares []types.Share) common.Hash {
	packed := make([]byte, 0, len(shares)*32)

	for _, s := range shares {
		el := make([]byte, 0, 96)
		el = append(el, shareTypehash...)
		el = append(el, common.LeftPadBytes(s.Recipient.Bytes(), 32)...)
		el = append(el, padUint(new(big.Int).SetUint64(uint64(s.ShareBps)))...)
		packed = append(packed, crypto.Keccak256(el)...)
	}

	return common.BytesToHash(crypto.Keccak256(packed))
}

// domainSeparator binds a signature to one policy clone on one chain.
//
// verifyingContract is the clone's own address, which is what makes a signature
// authorising one policy useless against another -- OpenZeppelin's EIP712 rebuilds
// the separator per clone for exactly this reason.
func domainSeparator(policy common.Address, chainID int64) common.Hash {
	buf := make([]byte, 0, 160)
	buf = append(buf, eip712DomainTypehash...)
	buf = append(buf, crypto.Keccak256([]byte(config.EIP712DomainName))...)
	buf = append(buf, crypto.Keccak256([]byte(config.EIP712DomainVersion))...)
	buf = append(buf, padUint(big.NewInt(chainID))...)
	buf = append(buf, common.LeftPadBytes(policy.Bytes(), 32)...)

	return common.BytesToHash(crypto.Keccak256(buf))
}

// eip712Preimage returns the 66 bytes that hash to the EIP-712 digest:
//
//	0x19 || 0x01 || domainSeparator || structHash
//
// We hand this to the node rather than the digest itself, because /sign always
// keccak256-hashes whatever it is given. Passing the preimage makes the node's
// own hashing produce precisely the digest ConfidentialPolicy computes, instead of
// hashing a digest a second time.
func eip712Preimage(
	policy common.Address,
	chainID int64,
	commitment common.Hash,
	shares []types.Share,
	triggeredAt *big.Int,
) []byte {
	structBuf := make([]byte, 0, 128)
	structBuf = append(structBuf, executionTypehash...)
	structBuf = append(structBuf, commitment.Bytes()...)
	structBuf = append(structBuf, hashShares(shares).Bytes()...)
	structBuf = append(structBuf, padUint(triggeredAt)...)
	structHash := crypto.Keccak256(structBuf)

	preimage := make([]byte, 0, 66)
	preimage = append(preimage, 0x19, 0x01)
	preimage = append(preimage, domainSeparator(policy, chainID).Bytes()...)
	preimage = append(preimage, structHash...)

	return preimage
}

func padUint(v *big.Int) []byte {
	return common.LeftPadBytes(v.Bytes(), 32)
}
