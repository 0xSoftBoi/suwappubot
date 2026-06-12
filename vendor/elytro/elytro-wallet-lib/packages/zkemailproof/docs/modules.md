[@elytro/zkemail-proof](README.md) / Modules

# @elytro/zkemail-proof

## Table of contents

### Classes

- [EmailApproverFactory](classes/EmailApproverFactory.md)
- [EmailProof](classes/EmailProof.md)

### Interfaces

- [ICreateEmailApproverArgs](interfaces/ICreateEmailApproverArgs.md)
- [IEmailProof](interfaces/IEmailProof.md)

### Type Aliases

- [IEmailApproverCircuitInputs](modules.md#iemailapprovercircuitinputs)

## Type Aliases

### IEmailApproverCircuitInputs

Ƭ **IEmailApproverCircuitInputs**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `email_header` | `string`[] |
| `email_header_length` | `string` |
| `pubkey` | `string`[] |
| `sender_domain_idx` | `string` |
| `sender_email_commitment_rand` | `string` |
| `sender_email_idx` | `string` |
| `signature` | `string`[] |
| `subject_idx` | `string` |

#### Defined in

[emailProof.ts:9](https://github.com/Elytro-eth/elytro-wallet-lib/blob/develop/packages/zkemailproof/src/emailProof.ts#L9)
