// Package config contains configuration values and defaults used by the extension.
package config

import (
	"os"
	"strconv"
	"time"
)

const (
	Version = "0.1.0"

	// OPTypePolicy must stay free of the "F_" prefix. go-flare-common reserves that
	// prefix for system operations and already defines F_POLICY for governance
	// policy; op.IsValid() rejects any non-system type carrying it, and a rejected
	// pair never reaches this extension at all. These strings must match the bytes32
	// constants in contracts/InstructionSender.sol exactly -- they are compared as
	// UTF-8 right-padded to 32 bytes, not hashed.
	OPTypePolicy = "POLICY"

	OPCommandStore    = "STORE"
	OPCommandEvaluate = "EVALUATE"

	// EIP712DomainName and EIP712DomainVersion mirror the EIP712 constructor
	// arguments in ConfidentialPolicy.sol. If they drift, every signature this
	// extension produces recovers to the wrong address and execute() reverts.
	EIP712DomainName    = "FlareStudioPolicy"
	EIP712DomainVersion = "1"

	TimeoutShutdown = 5 * time.Second
)

// Defaults.
var (
	ExtensionPort = 8080
	SignPort      = 9090

	// ChainID binds EIP-712 signatures to one network. Coston2 is 114. A zero value
	// is the documented cause of empty signatures, so treat it as fatal at use time
	// rather than silently signing for chain 0.
	ChainID int64
)

// Environment variables override defaults.
func init() {
	ep := os.Getenv("EXTENSION_PORT")
	sp := os.Getenv("SIGN_PORT")

	if ep != "" {
		if v, err := strconv.Atoi(ep); err == nil {
			ExtensionPort = v
		}
	}
	if sp != "" {
		if v, err := strconv.Atoi(sp); err == nil {
			SignPort = v
		}
	}

	if cid := os.Getenv("CHAIN_ID"); cid != "" {
		if v, err := strconv.ParseInt(cid, 10, 64); err == nil {
			ChainID = v
		}
	}
}
