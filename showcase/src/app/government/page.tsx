import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { ENTERPRISE_CONTACT_PATH } from '@/lib/links';
import styles from './government.module.css';

export const metadata: Metadata = {
  title: 'Government | Suwappu',
  description:
    'The Lattice Transfer Protocol (LTP) is Suwappu’s government arm: post-quantum ' +
    'data transfer with on-chain anchors, built for FedRAMP High environments. ' +
    'ML-KEM-768, ML-DSA-65, BLAKE3-256, 52 machine-checked Lean 4 theorems.',
  alternates: { canonical: '/government' },
};

const specs = [
  {
    label: 'Sender payload',
    value: '~1.3 KB sealed lattice key (ML-KEM-768): constant, independent of entity size',
  },
  {
    label: 'KEM primitive',
    value: 'ML-KEM-768 (FIPS 203 · NIST Level 3)',
  },
  {
    label: 'Signatures / Hash',
    value: 'ML-DSA-65 (FIPS 204) · BLAKE3-256 content addressing',
  },
  {
    label: 'Adversary model',
    value:
      'PPT adversary across Theorems 3-8 · Dolev-Yao active adversary in the Verifpal symbolic model',
  },
  {
    label: 'Composite barriers',
    value: '4, chained for Theorem 8 (CR · EUF-CMA · AUTH · IND-CCA2)',
  },
] as const;

const contributions = [
  { num: '01', code: 'PIPELINE', title: 'CLM as a Transfer Primitive' },
  { num: '02', code: 'EFFICIENCY', title: 'O(1) Sealed Lattice Key Transfer' },
  { num: '03', code: 'ADDRESSING', title: 'EntityID Construction' },
  { num: '04', code: 'PRIMITIVE', title: 'Receiver-Bound Transfer Token' },
  { num: '05', code: 'NETWORK', title: 'Commitment Network Distribution' },
  { num: '06', code: 'ADVERSARY', title: 'Composite Adversary Bound' },
  { num: '07', code: 'THEOREM', title: 'Transfer Immutability (Theorem 8)' },
  { num: '08', code: 'VERIFICATION', title: 'Storage Proof Verification' },
] as const;

const sections = [
  {
    num: '01',
    code: 'PIPELINE',
    title: 'CLM as a Transfer Primitive',
    body: [
      'LTP runs three phases in sequence. COMMIT deterministically shards the entity with Reed-Solomon k-of-n erasure coding, places the shards across the commitment network, and signs a commitment record onto an append-only Merkle log. LATTICE seals a constant-size lattice key to the receiver. MATERIALIZE lets the receiver reconstruct the entity from geographically nearby commitment nodes.',
      'No payload ever crosses the sender-receiver link directly: the sender commits once to the network, and every receiver materializes independently against that commitment.',
    ],
    whatsNew:
      'Prior content-addressed storage systems treat this shape as storage with sharing. LTP frames the same pipeline as a transfer protocol: an alternative to sending payloads at all.',
    figLabel: 'clm-pipeline.txt',
    fig: 'COMMIT      shard (k-of-n) + sign commitment record\n   ↓\nLATTICE     seal ~1,300B lattice key to receiver\n   ↓\nMATERIALIZE fetch k-of-n shards, decode, verify EntityID',
  },
  {
    num: '02',
    code: 'EFFICIENCY',
    title: 'O(1) Sealed Lattice Key Transfer',
    body: [
      'The sealed lattice key is ML-KEM-768 encapsulated to the receiver’s public key. Its size (~1,300 bytes, up from ~240 bytes pre-quantum) is fixed by the KEM ciphertext overhead, not by what it unlocks.',
      'A 1 KB note and a 1 TB dataset produce sealed keys of identical size. Total system bandwidth still scales with entity size and replication factor, but the direct sender→receiver bottleneck is eliminated.',
    ],
    whatsNew:
      'Machine-checked in Lean 4 as `lattice_key_size_payload_independent`: the sealed key is the same size whatever entity it unlocks.',
    figLabel: 'sealed-key-size.txt',
    fig: 'entity = 1 KB    → sealed lattice key ≈ 1,300 B\nentity = 1 TB    → sealed lattice key ≈ 1,300 B\nentity = N bytes → sealed lattice key ≈ 1,300 B  (O(1))',
  },
  {
    num: '03',
    code: 'ADDRESSING',
    title: 'EntityID Construction',
    body: [
      'Identity is content-addressed: EntityID = H(content ‖ shape ‖ timestamp ‖ sender_pubkey), with BLAKE3-256 as the default hash (BLAKE2b-256 is an equally valid alternative; ZK mode substitutes Poseidon for circuit-friendliness).',
      'Any modification to the content produces a different EntityID. Theorem 3 (Entity Immutability) proves this holds under H’s collision resistance.',
    ],
    whatsNew:
      'Because EntityID includes timestamp and sender_pubkey, re-committing identical content twice produces two distinct EntityIDs by design: a deliberate tradeoff, not an accident.',
    figLabel: 'entity-id.txt',
    fig: 'EntityID = H( content ‖ shape ‖ timestamp ‖ sender_pubkey )\n           default H = BLAKE3-256',
  },
  {
    num: '04',
    code: 'PRIMITIVE',
    title: 'Receiver-Bound Transfer Token',
    body: [
      'Unlike bearer-style access grants or static read-caps, the sealed lattice key is cryptographically bound to a specific receiver’s ML-KEM-768 encapsulation key, carries inline access policy (one-time, time-bounded, delegatable), and uses a fresh per-transfer encapsulation for forward secrecy.',
    ],
    whatsNew:
      'Capability + receiver binding + per-message forward secrecy + inline policy, packed into a constant-size token. The whitepaper’s claim is that this specific bundle, applied to asynchronous capability-based retrieval, is not present in prior systems.',
    figLabel: 'seal.txt',
    fig: 'seal():\n  (ss, kem_ct) = ML-KEM.Encaps(receiver_ek)   → fresh per transfer\n  key         = AEAD-wrap(lattice_key, ss)',
  },
  {
    num: '05',
    code: 'NETWORK',
    title: 'Commitment Network Distribution',
    body: [
      'Shard placement is derived from the EntityID via consistent hashing: no lookup service, no external metadata. Receivers materialize from geographically nearby commitment nodes, reconstructing from any k of n shards under Reed-Solomon erasure coding.',
    ],
    whatsNew:
      'Fewer than k shards leak only a proportional fraction of joint entropy. AEAD remains the primary confidentiality guarantee; the erasure threshold is defense in depth, not the sole barrier.',
    figLabel: 'placement.txt',
    fig: 'placement(shard_i) = ConsistentHash(EntityID ‖ shard_index) → node_set',
  },
  {
    num: '06',
    code: 'ADVERSARY',
    title: 'Composite Adversary Bound',
    body: [
      'LTP’s security proofs are stated against a standard PPT (probabilistic polynomial-time) adversary across Theorems 3-8. The corridor attestation flow and the COMMIT/LATTICE/MATERIALIZE message flow additionally have a symbolic Dolev-Yao model in Verifpal, run against an active attacker with full message-modification capability.',
    ],
    whatsNew:
      'The Verifpal run verified both confidentiality queries; both authentication queries currently fail on cross-session replay of the sealed key: a disclosed, tracked finding, not a hidden gap.',
    figLabel: 'adversary.txt',
    fig: 'Theorems 3-8:        PPT adversary\nVerifpal (symbolic):  Dolev-Yao active attacker\n                      (unbounded sessions, full message modification)',
  },
  {
    num: '07',
    code: 'THEOREM',
    title: 'Transfer Immutability (Theorem 8)',
    body: [
      'Theorem 8 bounds the adversary’s advantage in the Transfer Immutability (TIMM) composite game by the sum of four independent barrier advantages: hash collision resistance (CR), ML-DSA-65 unforgeability (EUF-CMA), AEAD authentication (AUTH), and ML-KEM-768 indistinguishability (IND-CCA2).',
      'The bound is a conservative union bound: winning via any single path still requires breaking two barriers in combination, never just one, so the true security margin is tighter than the sum suggests.',
    ],
    whatsNew:
      'A composite, chained security game across the full commit-to-materialize pipeline, rather than a proof about any one phase in isolation.',
    figLabel: 'theorem-8.txt',
    fig: 'Adv[TIMM] ≤ Adv[CR](H) + Adv[EUF-CMA](ML-DSA-65)\n            + Adv[AUTH](AEAD) + Adv[IND-CCA2](ML-KEM-768)',
  },
  {
    num: '08',
    code: 'VERIFICATION',
    title: 'Storage Proof Verification',
    body: [
      'On MATERIALIZE, the receiver fetches k-of-n shards, decrypts, erasure-decodes, and re-hashes the reconstructed content to confirm it matches the expected EntityID. Any tampering en route produces a different EntityID and fails the check.',
    ],
    whatsNew:
      'Verification is content-addressed and receiver-side: conditional on an honest append-only commitment log, no third party needs to be trusted to certify that materialized data matches what was committed.',
    figLabel: 'verify.txt',
    fig: 'verify:\n  H( decode(shards) ) == EntityID  ?  ACCEPT  :  REJECT',
  },
] as const;

const assurance = [
  {
    label: '01 · Readiness',
    title: 'FedRAMP High readiness package',
    body: 'An evidence overlay: a NIST SP 800-53 Rev. 5 control crosswalk, SSP-style implementation narratives, and system / trust-boundary documentation. This is a readiness package, not an authorization, agency sponsorship, 3PAO assessment, or ATO.',
  },
  {
    label: '02 · Fail-closed',
    title: 'A government deployment profile that refuses to run unsafe',
    body: 'Setting ETP_DEPLOYMENT_PROFILE=fedramp-high makes preflight fail closed on mock crypto, plaintext operator keys, missing KMS/HSM, missing mTLS, missing SIEM export, or dev/test RPC endpoints.',
  },
  {
    label: '03 · Verification',
    title: '52 machine-checked theorems, gated in CI',
    body: 'Lean 4 covers corridor 7-of-9 quorum safety and liveness, O(1) sealed-key size, and erasure thresholds; a Verifpal symbolic model covers the message flow. ~3,900 Python tests and ~340 Solidity test / invariant functions run alongside Slither and Echidna security audits.',
  },
  {
    label: '04 · Anchors',
    title: 'On-chain anchors with no standing admin key',
    body: 'LTPAnchorRegistry sits behind an ERC1967 proxy, governed by a 2-of-2 multisig plus a TimelockController; the deployer holds no privileged access post-deployment. (Live on SUWAPPU Testnet and Base Sepolia today.)',
    links: [
      {
        label: 'Anchor registry: verified source ↗',
        href: 'https://base-sepolia.blockscout.com/address/0x79eF1B7914f98C5C1404617449AB1f377c475996',
      },
      {
        label: 'Optimistic bridge challenge ↗',
        href: 'https://base-sepolia.blockscout.com/address/0x5083194d9e8EB54Fc397E69A518Be9503C767Dd0',
      },
      {
        label: 'Timelock governor ↗',
        href: 'https://base-sepolia.blockscout.com/address/0xc915740e35E38569E47f611eA5772Ff5278bc5Ae',
      },
    ],
  },
] as const;

export default function GovernmentPage() {
  return (
    <main id="main-content" className="summer-page docs-shell institutional-page">
      <SummerNav />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero">
          <p className="summer-kicker">Government / Lattice Transfer Protocol</p>
          <h1>Eight novel contributions to post-quantum transfer.</h1>
          <p className="mkt-hero__lead">
            LTP is a transfer primitive, not storage. The pipeline is{' '}
            <strong>Commit &rarr; Lattice &rarr; Materialize</strong>: no payload ever crosses
            the sender-receiver link. The sender commits, the receiver
            materializes. The Lattice Transfer Protocol is Suwappu&rsquo;s government arm:
            post-quantum data transfer with on-chain anchors, built for FedRAMP High
            environments.
          </p>
          <div className="summer-actions">
            <a className="institutional-link" href={ENTERPRISE_CONTACT_PATH}>
              Request the paper &rarr;
            </a>
          </div>
        </header>

        <section aria-label="Key specifications">
          <dl className={styles.specTable}>
            {specs.map((spec) => (
              <div className={styles.specRow} key={spec.label}>
                <dt>{spec.label}</dt>
                <dd>{spec.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="contributions-title">
          <div className="institutional-section__label">
            <span>Eight contributions</span>
            <span>Jump to any section</span>
          </div>
          <h2 id="contributions-title" className="mkt-h2" style={{ marginBottom: '2rem' }}>
            The protocol, in eight parts.
          </h2>
          <div className={styles.contribGrid}>
            {contributions.map((c) => (
              <a className={styles.contribCard} href={`#section-${c.num}`} key={c.num}>
                <span className={styles.contribNum}>{c.num}</span>
                <span className={styles.contribLabel}>{c.code}</span>
                <h3 className={styles.contribTitle}>{c.title}</h3>
              </a>
            ))}
          </div>
        </section>

        <section aria-label="Protocol detail">
          {sections.map((s) => (
            <article className={styles.detail} id={`section-${s.num}`} key={s.num}>
              <div className={styles.detailHead}>
                <div>
                  <p className={styles.detailKicker}>
                    {s.num} // {s.code}
                  </p>
                  <h2>{s.title}</h2>
                  <div className={styles.detailBody}>
                    {s.body.map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                    <p>
                      <strong>What&rsquo;s new:</strong> {s.whatsNew}
                    </p>
                  </div>
                </div>
                <div className={`sw-card-dark ${styles.figure}`}>
                  <div className="summer-code" aria-label={s.figLabel}>
                    <div className="summer-code__bar">
                      <span />
                      <span />
                      <span />
                      <b>{s.figLabel}</b>
                    </div>
                    <pre>
                      <code>{s.fig}</code>
                    </pre>
                  </div>
                  <p className={styles.figureCaption}>FIG. {s.num}</p>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="institutional-darkband" aria-labelledby="government-title">
          <div className="institutional-darkband__head">
            <h2 id="government-title">Built for government environments.</h2>
            <p>
              LTP is Suwappu&rsquo;s government arm: the same protocol, packaged with the
              evidence and fail-closed defaults a FedRAMP High evaluation actually asks for.
            </p>
          </div>
          <div className="institutional-register">
            {assurance.map((a) => (
              <article className="institutional-row" key={a.label}>
                <span className="institutional-row__number">{a.label.slice(0, 2)}</span>
                <span className="institutional-row__label">{a.label.slice(5)}</span>
                <h3>{a.title}</h3>
                <p>{a.body}</p>
                {'links' in a && (
                  <p className={styles.contractLinks}>
                    {a.links.map((l) => (
                      <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">
                        {l.label}
                      </a>
                    ))}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="mkt-cta" aria-labelledby="government-close">
          <p className="summer-kicker">Read the paper. Run the protocol.</p>
          <h2 id="government-close">Evaluate LTP for your environment.</h2>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href={ENTERPRISE_CONTACT_PATH}>
              Request the paper
            </a>
            <a className="summer-button summer-button--secondary" href={ENTERPRISE_CONTACT_PATH}>
              Talk to the team
            </a>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
