/**
 * LegalContent — shared Terms of Service and Privacy Policy content.
 * Used by Welcome page and Settings page modals.
 * Drafted per payment-industry standards. Should be reviewed by legal counsel.
 */

export function TosContent() {
  return (
    <>
      <p className="text-white/60 text-xs">Effective Date: April 1, 2026 · Last Updated: April 6, 2026</p>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">1. Agreement to Terms</h3>
        <p>These Terms of Service ("Terms") constitute a legally binding agreement between you ("User", "you") and iUSD Pay ("we", "us", "the Service"). By accessing, connecting a wallet to, or using the iUSD Pay platform, you acknowledge that you have read, understood, and agree to be bound by these Terms. If you do not agree, you must immediately cease all use of the Service.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">2. Description of Service</h3>
        <p>iUSD Pay is a decentralized stablecoin payment application built on the Initia blockchain (interwoven-1). The Service enables peer-to-peer transfers, payment requests, invoice generation, gift payments, and merchant payment acceptance using iUSD and other supported digital assets. The Service interacts with on-chain smart contracts and does not custody user funds.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">3. Eligibility</h3>
        <p>You must be at least 18 years of age (or the age of legal majority in your jurisdiction) to use the Service. By using the Service, you represent and warrant that you: (a) have the legal capacity to enter into these Terms; (b) are not located in, or a citizen or resident of, any jurisdiction where use of this Service is prohibited; (c) are not listed on any sanctions list maintained by the U.S. Department of the Treasury's OFAC, the European Union, the United Nations, or any other applicable authority.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">4. Wallet & Account</h3>
        <p>Access to the Service requires a compatible blockchain wallet connected via InterwovenKit or a supported wallet provider. You are solely responsible for maintaining the security of your wallet, private keys, seed phrases, and any credentials associated with your account. We do not have access to your private keys and cannot recover lost funds. Registration creates an on-chain identity (nickname, ID-DNA, payment card) linked to your wallet address.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">5. Payments & Transactions</h3>
        <p>All payments processed through iUSD Pay are executed via on-chain smart contracts. Transactions are irreversible once confirmed on the blockchain. You acknowledge that:</p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li>Transaction fees (currently 0.5%, capped at 5 iUSD) are deducted automatically and are non-refundable.</li>
          <li>Gas fees for blockchain operations are your responsibility and vary based on network conditions.</li>
          <li>Payment amounts are subject to minimum (0.1 iUSD) and maximum (1,000 iUSD per transaction) limits, which may be adjusted.</li>
          <li>We do not guarantee the execution, speed, or finality of any transaction.</li>
          <li>Payments are encrypted using viewing keys. Only the sender, recipient, and authorized parties with viewing access can decrypt payment details.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">6. Prohibited Activities</h3>
        <p>You agree not to use the Service for any of the following:</p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li>Money laundering, terrorist financing, sanctions evasion, tax evasion, or any form of financial crime.</li>
          <li>Processing payments for illegal goods, services, or activities under applicable law.</li>
          <li>Circumventing transaction limits, compliance monitoring, or security measures.</li>
          <li>Engaging in fraudulent chargebacks, unauthorized transactions, or identity theft.</li>
          <li>Interfering with, disrupting, or exploiting the Service, smart contracts, or underlying infrastructure.</li>
          <li>Using automated systems (bots, scripts) to interact with the Service without prior written consent.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">7. Compliance & Regulatory</h3>
        <p>iUSD Pay is committed to operating in compliance with applicable laws and regulations. By using the Service, you acknowledge and consent to the following:</p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li>All transaction data — including wallet addresses, payment amounts, timestamps, and counterparty information — may be subject to regulatory audit or legal review at any time.</li>
          <li>We may be required to disclose transaction records to law enforcement, regulatory authorities, or judicial bodies in response to lawful requests, subpoenas, or court orders.</li>
          <li>On-chain activity is permanently and publicly recorded on the Initia blockchain.</li>
          <li>We reserve the right to suspend, restrict, or terminate access to any account flagged by our compliance monitoring systems, third-party screening providers, or regulatory guidance.</li>
          <li>We may implement additional identity verification (KYC/AML) procedures at any time as required by applicable regulations.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">8. Risks & Disclaimers</h3>
        <p>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. You expressly acknowledge and accept the following risks:</p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li><strong>Smart contract risk:</strong> Bugs, vulnerabilities, or exploits in smart contracts may result in loss of funds.</li>
          <li><strong>Blockchain risk:</strong> Network congestion, forks, reorganizations, or validator failures may affect transactions.</li>
          <li><strong>Stablecoin risk:</strong> iUSD and other digital assets may lose their peg or value. We do not guarantee price stability.</li>
          <li><strong>Regulatory risk:</strong> Changes in law or regulation may restrict or prohibit the use of this Service in your jurisdiction.</li>
          <li><strong>Custody risk:</strong> You are solely responsible for the security of your wallet. We cannot recover lost or stolen funds.</li>
          <li><strong>Experimental status:</strong> The Service is under active development and may contain errors, undergo changes, or experience downtime without notice.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">9. Limitation of Liability</h3>
        <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL IUSD PAY, ITS DEVELOPERS, CONTRIBUTORS, AFFILIATES, OR SERVICE PROVIDERS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF FUNDS, DATA, PROFITS, OR BUSINESS OPPORTUNITIES, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE, WHETHER BASED ON WARRANTY, CONTRACT, TORT, OR ANY OTHER LEGAL THEORY.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">10. Indemnification</h3>
        <p>You agree to indemnify, defend, and hold harmless iUSD Pay and its team from and against any claims, liabilities, damages, losses, costs, or expenses (including reasonable legal fees) arising from your use of the Service, violation of these Terms, or infringement of any rights of a third party.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">11. Intellectual Property</h3>
        <p>All intellectual property rights in the Service, including but not limited to the iUSD Pay name, logo, Identity Card designs, ID-DNA system, user interface, and documentation, are owned by or licensed to iUSD Pay. You may not reproduce, distribute, modify, or create derivative works without prior written consent.</p>
        <p><strong>Gift imagery — Met Museum Open Access:</strong> The artwork images used in our Gift gallery are sourced from <a href="https://www.metmuseum.org/hubs/open-access" target="_blank" rel="noopener noreferrer" className="underline">The Metropolitan Museum of Art Open Access program</a>, which makes more than 490,000 images of public-domain works available under Creative Commons Zero (CC0). The Met Museum retains the underlying institutional credits; iUSD Pay makes no claim of ownership over these works, uses them solely to decorate digital gift experiences, and does not redistribute them outside the Service. Where applicable, object metadata follows the Met's attribution guidelines.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">12. Termination</h3>
        <p>We reserve the right to suspend or terminate your access to the Service at any time, with or without cause, and with or without notice. You may discontinue use at any time. Upon termination, unclaimed funds in smart contracts remain accessible via direct on-chain interaction.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">13. Governing Law & Dispute Resolution</h3>
        <p>These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which the Service operates, without regard to conflict of law principles. Any dispute arising under these Terms shall first be attempted to be resolved through good-faith negotiation. If unresolved within 30 days, disputes shall be submitted to binding arbitration under the rules of a mutually agreed arbitration body.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">14. Modifications</h3>
        <p>We reserve the right to modify these Terms at any time. Material changes will be communicated via the Service interface. Your continued use of the Service after any modification constitutes acceptance of the updated Terms. It is your responsibility to review these Terms periodically.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">15. Severability</h3>
        <p>If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary, and the remaining provisions shall remain in full force and effect.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">16. Contact</h3>
        <p>For questions, concerns, or legal inquiries regarding these Terms, please contact us on Discord: <a href="https://discord.gg/kKFd4nya" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>https://discord.gg/kKFd4nya</a></p>
      </section>
    </>
  )
}

export function PrivacyContent() {
  return (
    <>
      <p className="text-white/60 text-xs">Effective Date: April 1, 2026 · Last Updated: April 6, 2026</p>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">1. Introduction</h3>
        <p>This Privacy Policy ("Policy") describes how iUSD Pay ("we", "us", "the Service") collects, uses, stores, and protects information when you use our decentralized stablecoin payment platform. We are committed to protecting your privacy and handling your data in compliance with applicable data protection laws.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">2. Information We Collect</h3>
        <p><strong>2.1 Information you provide:</strong></p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li><strong>Wallet address:</strong> Your blockchain wallet address, stored in encrypted form in our database.</li>
          <li><strong>Nickname:</strong> A display name you choose or that is auto-generated during registration.</li>
          <li><strong>Viewing key:</strong> A cryptographic key derived from your wallet signature, used to decrypt payment details.</li>
          <li><strong>Contact information:</strong> Contacts you save (their shortIds, nicknames, aliases) stored locally on your device.</li>
          <li><strong>Merchant profile:</strong> Business name and payment preferences if you enable merchant features.</li>
        </ul>
        <p><strong>2.2 Information collected automatically:</strong></p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li><strong>Transaction data:</strong> Payment amounts, timestamps, sender/recipient identifiers, and transaction hashes recorded on-chain.</li>
          <li><strong>Device information:</strong> Browser type, operating system, screen resolution, and device identifiers (for QR scanning and wallet connection).</li>
          <li><strong>Usage data:</strong> Pages visited, features used, and interaction patterns within the app.</li>
        </ul>
        <p><strong>2.3 Information we do NOT collect:</strong></p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li>Real names, email addresses, phone numbers, or government-issued identification (unless required by future regulatory obligations).</li>
          <li>Private keys, seed phrases, or wallet passwords.</li>
          <li>Precise geolocation data.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">3. How We Use Your Information</h3>
        <p>We use collected information for the following purposes:</p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li><strong>Service delivery:</strong> Processing payments, routing transactions, maintaining your account, and displaying payment history.</li>
          <li><strong>Security:</strong> Detecting fraudulent or unauthorized activity, enforcing our Terms of Service, and protecting the integrity of the platform.</li>
          <li><strong>Compliance:</strong> Meeting legal obligations, responding to lawful requests from regulatory or law enforcement authorities, and conducting AML/KYC procedures if required.</li>
          <li><strong>Improvement:</strong> Analyzing aggregate usage patterns to improve the Service (we do not track individual behavior for advertising purposes).</li>
        </ul>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">4. Data Sharing & Disclosure</h3>
        <p>We do not sell, rent, or trade your personal information. We may share information in the following circumstances:</p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li><strong>On-chain transparency:</strong> Transaction data is publicly visible on the Initia blockchain by design. iUSD Pay uses encrypted payment pools to reduce on-chain linkability, but full anonymity cannot be guaranteed.</li>
          <li><strong>Legal compliance:</strong> We may disclose information to law enforcement, regulators, or judicial bodies when required by law, subpoena, court order, or regulatory request.</li>
          <li><strong>Service providers:</strong> We use third-party services (Privy for social login, InterwovenKit for wallet connectivity) that may process data under their own privacy policies.</li>
          <li><strong>Business transfers:</strong> In the event of a merger, acquisition, or asset sale, user data may be transferred as part of the transaction, subject to the same protections described in this Policy.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">5. Data Storage & Security</h3>
        <p>We implement industry-standard security measures to protect your data, including:</p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li>Encryption of wallet addresses and sensitive data at rest and in transit (TLS 1.3).</li>
          <li>Access controls limiting data access to authorized personnel and systems.</li>
          <li>Regular security audits of smart contracts and backend infrastructure.</li>
          <li>Contact data is stored locally on your device and is not uploaded to our servers unless explicitly synced.</li>
        </ul>
        <p>Despite these measures, no system is completely secure. You acknowledge that you use the Service at your own risk.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">6. Data Retention</h3>
        <p>We retain your account data for as long as your account is active or as needed to provide the Service. Upon account deletion:</p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li>Your profile (nickname, viewing key, merchant data) is removed from our database.</li>
          <li>On-chain transaction history remains permanently on the blockchain and cannot be deleted.</li>
          <li>We may retain certain data as required by law or for legitimate compliance purposes.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">7. Your Rights</h3>
        <p>Depending on your jurisdiction, you may have the following rights regarding your personal data:</p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
          <li><strong>Correction:</strong> Request correction of inaccurate data.</li>
          <li><strong>Deletion:</strong> Request deletion of your account and associated data (subject to legal retention requirements).</li>
          <li><strong>Portability:</strong> Request your data in a machine-readable format.</li>
          <li><strong>Objection:</strong> Object to processing of your data for specific purposes.</li>
        </ul>
        <p>To exercise these rights, contact us through the channels listed below.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">8. Third-Party Services</h3>
        <p>The Service integrates with the following third-party services, each governed by their own privacy policies:</p>
        <ul className="flex flex-col gap-1 pl-3 list-disc list-inside">
          <li><strong>Privy:</strong> Social login and embedded wallet authentication.</li>
          <li><strong>InterwovenKit:</strong> Blockchain wallet connectivity and transaction signing.</li>
          <li><strong>Initia blockchain:</strong> On-chain transaction execution and data storage.</li>
        </ul>
        <p>We are not responsible for the privacy practices of third-party services.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">9. Cookies & Local Storage</h3>
        <p>iUSD Pay uses browser local storage (not cookies) to store session tokens, user preferences (e.g., balance visibility), contact lists, and application state. This data remains on your device and is not transmitted to third-party analytics or advertising services.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">10. Children's Privacy</h3>
        <p>The Service is not intended for individuals under the age of 18. We do not knowingly collect data from minors. If we become aware that a minor has provided personal data, we will take steps to delete it promptly.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">11. International Data Transfers</h3>
        <p>Your data may be processed in jurisdictions outside your country of residence. By using the Service, you consent to the transfer of your information to jurisdictions that may have different data protection standards than your own.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">12. Changes to This Policy</h3>
        <p>We may update this Privacy Policy from time to time. Material changes will be communicated via the Service interface. Your continued use after changes constitutes acceptance. We encourage you to review this Policy periodically.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-white/70 text-xs font-medium">13. Contact Us</h3>
        <p>For privacy-related inquiries, data requests, or concerns, please contact us on Discord: <a href="https://discord.gg/kKFd4nya" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>https://discord.gg/kKFd4nya</a></p>
      </section>
    </>
  )
}
