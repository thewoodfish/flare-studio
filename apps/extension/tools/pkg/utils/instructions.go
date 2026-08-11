package utils

import (
	"context"
	"math/big"
	"time"

	"policy-extension/tools/pkg/contracts/policy"
	"policy-extension/tools/pkg/fccutils"
	"policy-extension/tools/pkg/support"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/pkg/errors"
)

func DeployInstructionSender(s *support.Support) (common.Address, *policy.PolicyInstructionSender, error) {
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Address{}, nil, errors.Errorf("failed to create transactor: %s", err)
	}

	// Both registry args are the FlareTeeManager diamond proxy: the diamond
	// routes ExtensionManager and MachineManager calls to the right facets.
	address, tx, contract, err := policy.DeployPolicyInstructionSender(
		opts, s.ChainClient, s.Addresses.FlareTeeManager, s.Addresses.FlareTeeManager,
	)
	if err != nil {
		return common.Address{}, nil, errors.Errorf("failed to deploy contract: %s", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	receipt, err := bind.WaitMined(ctx, s.ChainClient, tx)
	if err != nil {
		return common.Address{}, nil, errors.Errorf("deployment tx not mined within 2 minutes (tx: %s): %s", tx.Hash().Hex(), err)
	}

	if receipt.Status != types.ReceiptStatusSuccessful {
		return common.Address{}, nil, errors.New("contract deployment failed")
	}

	return address, contract, nil
}

func SetExtensionId(s *support.Support, instructionSenderAddress common.Address) error {
	sender, err := policy.NewPolicyInstructionSender(instructionSenderAddress, s.ChainClient)
	if err != nil {
		return errors.Errorf("failed to bind contract: %s", err)
	}

	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return errors.Errorf("failed to create transactor: %s", err)
	}

	tx, err := sender.SetExtensionId(opts)
	if err != nil {
		reason := fccutils.DecodeRevertReason(err)
		if reason == "" {
			parsed, _ := policy.PolicyInstructionSenderMetaData.GetAbi()
			if parsed != nil {
				callData, packErr := parsed.Pack("setExtensionId")
				if packErr == nil {
					from := crypto.PubkeyToAddress(s.Prv.PublicKey)
					reason = fccutils.SimulateAndDecodeRevert(
						s.ChainClient, from, instructionSenderAddress, nil, callData,
					)
				}
			}
		}
		if reason != "" {
			return errors.Errorf("failed to call setExtensionId: %s (revert reason: %s)", err, reason)
		}
		return errors.Errorf("failed to call setExtensionId: %s", err)
	}

	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return errors.Errorf("failed waiting for transaction: %s", err)
	}

	if receipt.Status != types.ReceiptStatusSuccessful {
		parsed, _ := policy.PolicyInstructionSenderMetaData.GetAbi()
		if parsed != nil {
			callData, packErr := parsed.Pack("setExtensionId")
			if packErr == nil {
				from := crypto.PubkeyToAddress(s.Prv.PublicKey)
				reason := fccutils.SimulateAndDecodeRevert(
					s.ChainClient, from, instructionSenderAddress, nil, callData,
				)
				if reason != "" {
					return errors.Errorf("setExtensionId transaction failed (revert reason: %s)", reason)
				}
			}
		}
		return errors.New("setExtensionId transaction failed")
	}

	return nil
}

// InstructionFee is the fee in wei carried by every instruction. It must match
// the registry's required fee.
var InstructionFee = big.NewInt(1000000)

// SendStorePolicy hands the enclave a policy's ECIES-encrypted private half.
func SendStorePolicy(
	s *support.Support,
	instructionSenderAddress common.Address,
	policyAddress common.Address,
	ciphertext []byte,
) (common.Hash, common.Hash, error) {
	return sendInstruction(s, instructionSenderAddress, "sendStorePolicy",
		[]any{policyAddress, ciphertext},
		func(sender *policy.PolicyInstructionSender, opts *bind.TransactOpts) (*types.Transaction, error) {
			return sender.SendStorePolicy(opts, policyAddress, ciphertext)
		},
	)
}

// SendEvaluatePolicy asks the enclave to sign the committed distribution.
func SendEvaluatePolicy(
	s *support.Support,
	instructionSenderAddress common.Address,
	policyAddress common.Address,
	triggeredAt *big.Int,
) (common.Hash, common.Hash, error) {
	return sendInstruction(s, instructionSenderAddress, "sendEvaluatePolicy",
		[]any{policyAddress, triggeredAt},
		func(sender *policy.PolicyInstructionSender, opts *bind.TransactOpts) (*types.Transaction, error) {
			return sender.SendEvaluatePolicy(opts, policyAddress, triggeredAt)
		},
	)
}

// sendInstruction carries the send-and-await boilerplate for every op.
//
// The revert decoding is the part worth keeping: a bare "execution reverted"
// from this contract is almost always one of a handful of causes (extension id
// unset, fee too low, no registered machines), and re-simulating the failed call
// is what turns it into a sentence you can act on. `args` exists solely so the
// call can be re-packed for that simulation.
func sendInstruction(
	s *support.Support,
	instructionSenderAddress common.Address,
	method string,
	args []any,
	call func(*policy.PolicyInstructionSender, *bind.TransactOpts) (*types.Transaction, error),
) (common.Hash, common.Hash, error) {
	sender, err := policy.NewPolicyInstructionSender(instructionSenderAddress, s.ChainClient)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to bind contract: %s", err)
	}

	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to create transactor: %s", err)
	}
	opts.Value = InstructionFee

	simulate := func() string {
		parsed, abiErr := policy.PolicyInstructionSenderMetaData.GetAbi()
		if abiErr != nil || parsed == nil {
			return ""
		}
		callData, packErr := parsed.Pack(method, args...)
		if packErr != nil {
			return ""
		}
		from := crypto.PubkeyToAddress(s.Prv.PublicKey)
		return fccutils.SimulateAndDecodeRevert(
			s.ChainClient, from, instructionSenderAddress, InstructionFee, callData,
		)
	}

	tx, err := call(sender, opts)
	if err != nil {
		reason := fccutils.DecodeRevertReason(err)
		if reason == "" {
			reason = simulate()
		}
		if reason != "" {
			return common.Hash{}, common.Hash{}, errors.Errorf("failed to send %s: %s (revert reason: %s)", method, err, reason)
		}
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to send %s: %s", method, err)
	}

	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed waiting for transaction: %s", err)
	}

	if receipt.Status != 1 {
		if reason := simulate(); reason != "" {
			return common.Hash{}, common.Hash{}, errors.Errorf("%s failed with status %d (revert reason: %s)", method, receipt.Status, reason)
		}
		return common.Hash{}, common.Hash{}, errors.Errorf("%s failed with status: %d", method, receipt.Status)
	}

	// Scan every log rather than assuming index 0: TeeInstructionsSent is emitted
	// by the registry, and our own contract could emit ahead of it.
	for _, log := range receipt.Logs {
		instructionSent, parseErr := s.TeeVerification.ParseTeeInstructionsSent(*log)
		if parseErr == nil {
			return instructionSent.InstructionId, receipt.TxHash, nil
		}
	}

	return common.Hash{}, common.Hash{}, errors.Errorf(
		"no TeeInstructionsSent event in receipt for %s -- is the extension id set?", method)
}
