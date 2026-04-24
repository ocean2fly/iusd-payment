/**
 * Terms of Service
 *
 * When a user connects their wallet and signs the ToS, we record:
 *   - wallet address (hashed for privacy)
 *   - ToS version they agreed to
 *   - timestamp
 *   - their self-declared jurisdiction
 *   - wallet signature (proves acceptance)
 *
 * This creates a legal record that the user:
 *   1. Is not a sanctioned entity (self-declared)
 *   2. Accepted the ToS at a specific version
 *   3. Was informed of the compliance disclosure obligations
 *   4. Consented to lawful data sharing with regulators/auditors
 *
 * No ID verification — this is a declaration, not KYC.
 * IMPORTANT: Section 7 (Data Visibility) and Section 8 (Legal Disclosure)
 * must be prominently displayed — they explain what encryption does and
 * does NOT protect, and under what conditions data is shared with authorities.
 */

export const CURRENT_TOS_VERSION = '1.1.0'

export const TOS_TEXT = `
iPay Terms of Service v${CURRENT_TOS_VERSION}

─────────────────────────────────────────────────────────────────
IMPORTANT: Please read Section 7 and Section 8 carefully.
They describe the limits of encryption privacy and your data rights.
─────────────────────────────────────────────────────────────────

By connecting your wallet and signing this message, you agree to the
following terms and make the following declarations:

1. SANCTIONS COMPLIANCE
   You are not a Specially Designated National (SDN) or blocked person
   on any OFAC, UN, EU, or other applicable sanctions list. You are not
   located in, organized in, or ordinarily resident in any jurisdiction
   subject to comprehensive sanctions (including North Korea, Iran, Cuba,
   Syria, or the Crimea/Donetsk/Luhansk regions of Ukraine).

2. LAWFUL USE
   You will not use iPay to facilitate money laundering, terrorist
   financing, tax evasion, or any other illegal activity.

3. NON-CUSTODIAL PROTOCOL
   iPay is a non-custodial protocol. The iPay team does not hold your
   funds, your spending key, or your viewing key. You are solely
   responsible for the security of your keys.

4. COMPLIANCE RECORDS — ALWAYS ON-CHAIN (ALWAYS PUBLIC)
   A permanent compliance record is created on-chain for EVERY transaction.
   This record includes:
     • Nullifier (proof of spend — public, permanent)
     • Order ID (payment reference — public, permanent)
     • Timestamp (block time — public, permanent)
     • Instrument type (payment / invoice / subscription / etc.)
     • Recipient chain (IBC destination)
   These records are publicly readable by anyone with blockchain access,
   including regulators, law enforcement, and auditors, WITHOUT requiring
   your viewing key. This data CANNOT be deleted or hidden.

5. ENCRYPTED PAYMENT NOTES — PRIVATE BUT RETAINED
   The contents of your payment notes (amount, memo, counterparty details)
   are encrypted and stored for a mandatory 5-year retention period in
   accordance with FATF Recommendation 12, AMLD5/6, and applicable AML
   laws. After 5 years, you may request deletion.
   These notes can ONLY be decrypted with your viewing key.

6. AUDIT PACKAGES — USER-CONTROLLED DISCLOSURE
   You may voluntarily generate a signed audit package to share your
   payment history with auditors, tax authorities, or other third parties.
   This is always your choice. The platform does not generate audit packages
   on your behalf without your explicit wallet signature authorization.
   When you share your viewing key with an auditor, that auditor can
   decrypt your payment notes for the scope and period you specified.

7. WHAT ENCRYPTION PROTECTS — AND WHAT IT DOES NOT

   Encryption DOES protect:
     ✓ Payment amounts (encrypted in payment payloads)
     ✓ Recipient identity (encrypted in recipient blob)
     ✓ Payment memo / notes (encrypted, viewing key required)
     ✓ Gift claim keys (encrypted for recipients)

   Encryption DOES NOT protect:
     ✗ On-chain compliance records (nullifier, order ID, timestamp —
       always public, always readable by anyone)
     ✗ The fact that a transaction occurred (commitment is on-chain)
     ✗ Blockchain-level metadata (gas payer, transaction fees)
     ✗ Data you voluntarily disclose via audit packages

8. LEGAL DISCLOSURE TO AUTHORITIES — CONTRACT OWNER OBLIGATIONS

   YOU ACKNOWLEDGE AND AGREE THAT:

   a) The iPay contract owner (protocol operator) has access to all
      on-chain compliance records described in Section 4. These records
      are publicly readable on the blockchain by design.

   b) The iPay contract owner is legally obligated to cooperate with
      valid legal process, including court orders, subpoenas, regulatory
      demands, and law enforcement requests from competent authorities.

   c) In response to valid legal process, the iPay contract owner may
      provide to authorities:
        • All on-chain compliance records (always accessible)
        • Aggregated platform statistics (transaction counts, volumes)
        • Any user-generated audit packages previously submitted
        • Technical assistance in interpreting blockchain data

   d) The iPay contract owner CANNOT provide to authorities (absent your
      cooperation) the contents of encrypted payment notes, as the
      platform does not hold your viewing key or spending key.

   e) If YOU are the subject of a legal investigation and authorities
      compel disclosure, you may be legally required to provide your
      viewing key. iPay has no control over such compelled disclosure.

   f) The platform will make reasonable efforts to notify users of legal
      demands where permitted by law, but cannot guarantee notification
      in all circumstances (e.g., where prohibited by court order).

9. RECORD RETENTION AND DELETION
   Encrypted payment notes are retained for a mandatory 5-year period.
   You may archive (hide from UI) notes at any time. True deletion is
   only permitted after the 5-year retention period expires.
   On-chain compliance records (Section 4) are permanent and cannot
   be deleted under any circumstances.

10. CHANGES TO TERMS
    Material changes to these Terms will be notified on the iPay website
    and will require re-acceptance via wallet signature before continued use.
    Your continued use after re-acceptance constitutes agreement.

─────────────────────────────────────────────────────────────────
By signing, you confirm that you have READ and UNDERSTOOD this
agreement, including the encryption privacy limitations in Section 7 and
the legal disclosure obligations in Section 8.
─────────────────────────────────────────────────────────────────
`.trim()

/**
 * Short version displayed in UI (collapsible "read more" shows full text).
 * Must include the key privacy limitation warning.
 */
export const TOS_SUMMARY = `
By connecting your wallet you agree to the iPay Terms of Service.

Key points:
• iPay is non-custodial — we never hold your keys or funds
• Encryption hides payment amounts, memos, and recipient details — but on-chain
  compliance records (order ID, timestamp) are always public
• The platform operator may provide compliance records to authorities
  under valid legal process (court orders, regulatory demands)
• Encrypted payment notes are retained for 5 years (FATF compliance)
• You control audit disclosures — share your viewing key only when you choose

⚠️  Section 7 explains encryption privacy limits.
⚠️  Section 8 explains legal disclosure obligations.
`.trim()

export const CURRENT_TOS_VERSION_STRING = CURRENT_TOS_VERSION

export interface TosRecord {
  walletAddressHash: string   // sha256(address) — never the address itself
  tosVersion:        string
  acceptedAt:        number   // unix timestamp
  jurisdiction:      string   // self-declared (e.g. "SG", "AE", "unknown")
  signature:         string   // wallet signature over hash(ToS text + timestamp)
  /** User confirmed they read Section 7 (encryption limits) */
  confirmedEncryptionLimits: boolean
  /** User confirmed they read Section 8 (legal disclosure) */
  confirmedLegalDisclosure: boolean
}
