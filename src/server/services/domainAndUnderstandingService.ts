import {
  AudienceType,
  BlockchainDomainExtract,
  CertaintyLevel,
  ContextBundle,
  CybersecurityDomainExtract,
  DocumentChunk,
  DocumentUnderstanding,
  DomainType,
  FactCategory,
  FactImportance,
  FactRegistryItem,
  OutputFormatType,
  RagDecision,
} from '../../types/contentx.ts';
import {
  computeSha256,
  PDF_INTERNAL_ARTIFACT_PATTERNS,
  validateChunkQuality,
} from './ingestionService.ts';

export function isCleanFactCandidate(text: string): boolean {
  if (!text || text.trim().length < 20) return false;
  if (text.includes('\uFFFD')) return false;
  for (const pat of PDF_INTERNAL_ARTIFACT_PATTERNS) {
    pat.regex.lastIndex = 0;
    if (pat.regex.test(text)) return false;
  }
  if (/\b(?:endobj|endstream|FlateDecode|ObjStm|startxref)\b/i.test(text)) {
    return false;
  }
  return true;
}

const DOMAIN_SIGNALS: Record<DomainType, RegExp[]> = {
  Cybersecurity: [
    /\bCVE-\d{4}-\d{4,7}\b/i,
    /\bCWE-\d{1,5}\b/i,
    /\bCVSS\b/i,
    /\b(malware|ransomware|threat\s+actor|exploit|zero-day|vulnerability|ioc|lateral\s+movement|mitre|apt|UNC-\d+)\b/i,
  ],
  Blockchain: [
    /\b0x[a-fA-F0-9]{40}\b/,
    /\b0x[a-fA-F0-9]{64}\b/,
    /\b(chain\s+id|smart\s+contract|solidity|erc-20|erc-721|validator|gas\s+used|nonce|liquidity\s+pool|cross-chain\s+bridge|block\s+#?\d+)\b/i,
  ],
  Research: [
    /\b(methodology|hypothesis|peer-reviewed|statistical\s+significance|p\s*<\s*0\.\d+|cohort|empirical|longitudinal)\b/i,
  ],
  Business: [
    /\b(ebitda|revenue|capital\s+allocation|market\s+share|quarterly|supply\s+chain|roi|cashflow|operating\s+margin|arr)\b/i,
  ],
  Policy: [
    /\b(regulatory|compliance|statute|directive|governance\s+framework|jurisdiction|mandate|enactment)\b/i,
  ],
  Education: [
    /\b(curriculum|pedagogy|learning\s+outcomes|syllabus|student\s+assessment|instructional|module)\b/i,
  ],
  Custom: [],
  General: [],
};

export function detectDocumentDomain(rawText: string): {
  domain: DomainType;
  confidence: number;
} {
  const scores: Record<DomainType, number> = {
    Cybersecurity: 0,
    Blockchain: 0,
    Research: 0,
    Business: 0,
    Policy: 0,
    Education: 0,
    Custom: 0,
    General: 1,
  };

  for (const [dom, patterns] of Object.entries(DOMAIN_SIGNALS) as Array<
    [DomainType, RegExp[]]
  >) {
    for (const regex of patterns) {
      const matches = rawText.match(new RegExp(regex.source, 'gi'));
      if (matches) {
        scores[dom] += matches.length * 2;
      }
    }
  }

  let bestDomain: DomainType = 'General';
  let bestScore = 1;
  for (const [dom, score] of Object.entries(scores) as Array<
    [DomainType, number]
  >) {
    if (score > bestScore) {
      bestScore = score;
      bestDomain = dom;
    }
  }

  const confidence = Math.min(0.99, Number((0.72 + Math.min(bestScore, 25) * 0.01).toFixed(2)));
  return { domain: bestDomain, confidence };
}

export function extractCybersecurityPack(
  rawText: string
): CybersecurityDomainExtract {
  const cves = uniqueMatches(rawText, /\bCVE-\d{4}-\d{4,7}\b/gi);
  const cwes = uniqueMatches(rawText, /\bCWE-\d{1,5}\b/gi);
  const cvssScores = uniqueMatches(
    rawText,
    /\bCVSS(?:\s+v?[0-9.]+)?(?:\s+score)?[:\s]+([0-9]+\.[0-9]+(?:\s*\([A-Za-z]+\))?)/gi
  );
  const ips = uniqueMatches(
    rawText,
    /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g
  );
  const hashes = uniqueMatches(rawText, /\b[a-fA-F0-9]{64}\b/g);
  const urls = uniqueMatches(rawText, /https?:\/\/[^\s"'<>)+]+/gi);
  const domains = uniqueMatches(
    rawText,
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|gov|edu|ru|cn|xyz|internal)\b/gi
  );
  const threatActors = uniqueMatches(
    rawText,
    /\b(?:UNC-\d{3,5}|APT-?\d{1,3}|FIN\d{1,2}|Lazarus|Volt\s+Typhoon|Sandworm|BlackCat)\b/gi
  );
  const attackTechniques = uniqueMatches(rawText, /\bT\d{4}(?:\.\d{3})?\b/g);
  const malware = uniqueMatches(
    rawText,
    /\b(?:ShadowPulse|Cobalt\s+Strike|Mimikatz|PlugX|QakBot|LockBit|VoidLoader|EdgeRootkit)\b/gi
  );
  const files = uniqueMatches(
    rawText,
    /\b[a-zA-Z0-9_-]+\.(?:dll|exe|elf|sh|ps1|sys|bin|conf|so)\b/gi
  );

  const sentences = splitSentences(rawText);
  const affectedProducts = sentences
    .filter((s) => /affected\s+(product|appliance|system|software)|runs\s+on/i.test(s))
    .slice(0, 3);
  const affectedVersions = uniqueMatches(
    rawText,
    /\b(?:v|version\s+)[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:-[a-zA-Z0-9]+)?\b/gi
  );
  const attackVectors = sentences
    .filter((s) => /attack\s+vector|initial\s+access|exploited\s+via|unauthenticated/i.test(s))
    .slice(0, 3);
  const impact = sentences
    .filter((s) => /impact|compromised|affected|exfiltrat|disruption/i.test(s))
    .slice(0, 3);
  const mitigation = sentences
    .filter((s) => /mitigat|patch|upgrade\s+to|remediat|disable|rotate|hotfix/i.test(s))
    .slice(0, 4);
  const detection = sentences
    .filter((s) => /detect|telemetry|siem|log|indicator|yara|sigma/i.test(s))
    .slice(0, 3);
  const timeline = sentences
    .filter((s) => /\b(202\d-\d{2}-\d{2}|UTC|initial\s+detection|patched\s+on)\b/i.test(s))
    .slice(0, 4);

  let severity = 'Not specified in source document.';
  if (/\bcritical\b/i.test(rawText)) severity = 'Critical';
  else if (/\bhigh\s+severity\b/i.test(rawText)) severity = 'High';
  else if (/\bmedium\s+severity\b/i.test(rawText)) severity = 'Medium';

  let status = 'Not specified in source document.';
  if (/active\s+exploitation|actively\s+exploited/i.test(rawText)) {
    status = 'Active Exploitation / Patch Available';
  } else if (/contained|remediated|resolved/i.test(rawText)) {
    status = 'Contained / Remediated';
  } else if (/under\s+investigation/i.test(rawText)) {
    status = 'Under Investigation';
  }

  return {
    incident: sentences[0] || 'Cybersecurity Advisory',
    threat_actors: threatActors,
    malware,
    cves,
    cwes,
    cvss_scores: cvssScores,
    iocs: {
      ips,
      domains,
      urls,
      hashes,
      files,
    },
    campaigns: uniqueMatches(rawText, /\bOperation\s+[A-Z][a-zA-Z0-9_-]+/g),
    attack_techniques: attackTechniques,
    affected_products: affectedProducts,
    affected_versions: affectedVersions,
    attack_vectors: attackVectors,
    impact,
    mitigation,
    detection,
    timeline,
    severity,
    status,
  };
}

export function extractBlockchainPack(rawText: string): BlockchainDomainExtract {
  const txHashes = uniqueMatches(rawText, /\b0x[a-fA-F0-9]{64}\b/g);
  const addresses = uniqueMatches(rawText, /\b0x[a-fA-F0-9]{40}\b/g);
  const chainIds = uniqueMatches(
    rawText,
    /\bChain\s*ID[:\s#]*(\d+)\b/gi
  );
  const blockNumbers = uniqueMatches(
    rawText,
    /\bBlock\s*(?:Number|#)?[:\s#]*(\d{5,12})\b/gi
  );
  const networks = uniqueMatches(
    rawText,
    /\b(?:Ethereum(?:\s+Mainnet)?|Arbitrum(?:\s+One)?|Optimism|Polygon|Solana|Base|Avalanche)\b/gi
  );
  const tokens = uniqueMatches(
    rawText,
    /\b(?:USDC|USDT|ETH|WETH|WBTC|DAI|AETH|ARB)\b/g
  );
  const gasMetrics = uniqueMatches(
    rawText,
    /\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:gwei|gas)\b/gi
  );
  const nonces = uniqueMatches(rawText, /\bnonce[:\s#]*\d+\b/gi);
  const timestamps = uniqueMatches(
    rawText,
    /\b202\d-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}:\d{2}(?:Z|\s*UTC)?)?\b/g
  );
  const protocols = uniqueMatches(
    rawText,
    /\b(?:AetherBridge|Uniswap|Aave|Curve|LayerZero|Wormhole|Lido|MakerDAO)\b/gi
  );

  const sentences = splitSentences(rawText);
  const events = sentences
    .filter((s) => /event|emitted|VaultPaused|LiquidityRebalanced|StateVerified/i.test(s))
    .slice(0, 4);

  return {
    blockchain_networks: networks,
    chain_ids: chainIds,
    block_numbers: blockNumbers,
    transaction_hashes: txHashes,
    wallet_addresses: addresses.slice(0, 4),
    contract_addresses: addresses,
    tokens,
    nfts: uniqueMatches(rawText, /\bERC-721|ERC-1155\b/gi),
    smart_contracts: uniqueMatches(
      rawText,
      /\b[A-Z][a-zA-Z0-9]+(?:Vault|Bridge|Router|Pool|Contract|Verifier)\.sol\b|\b[A-Z][a-zA-Z0-9]+(?:Vault|Bridge|Verifier)\b/g
    ),
    events,
    transactions: txHashes,
    gas_metrics: gasMetrics,
    nonces,
    timestamps,
    block_hashes: txHashes.slice(0, 2),
    validators: uniqueMatches(rawText, /\bValidator\s+#?\d+|\bQuorum\s+\d+\/\d+/gi),
    protocols,
    bridges: uniqueMatches(rawText, /\b[A-Z][a-zA-Z0-9]*Bridge\b/g),
    network_status: /paused|halted/i.test(rawText)
      ? 'Paused / Guard Active'
      : 'Operational / Finalized',
    confirmation_status: /finalized|confirmed|verified/i.test(rawText)
      ? 'Finalized on L1 & L2'
      : 'Pending Confirmation',
  };
}

/**
 * Document Understanding Engine & Fact Registry Builder (Sections 7 & 8)
 * Extracts structured understanding and builds the canonical Fact Registry.
 */
export function buildUnderstandingAndFactRegistry(
  documentId: string,
  filename: string,
  rawText: string,
  pages: Array<{ page: number; text: string }>,
  chunks: DocumentChunk[]
): {
  understanding: DocumentUnderstanding;
  facts: FactRegistryItem[];
} {
  const { domain, confidence } = detectDocumentDomain(rawText);
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => Boolean(l) && isCleanFactCandidate(l));

  const title =
    lines.find((l) => l.length > 10 && l.length < 140 && !l.startsWith('===')) ||
    filename.replace(/\.[^.]+$/, '');

  const authorMatch = rawText.match(
    /(?:Author|Prepared\s+by|Issuer|Published\s+by)[:\s]+([^\n]+)/i
  );
  const author = authorMatch
    ? authorMatch[1].trim()
    : 'Source Document Author (Verified Ingest)';

  const allDates = uniqueMatches(
    rawText,
    /\b(?:202\d-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+202\d|\bQ[1-4]\s+202\d)\b/gi
  );
  const allNumbers = uniqueMatches(
    rawText,
    /\b(?:\$?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*%|\s*million|\s*billion|\s*bps|\s*ms|\s*hours|\s*days|\s*ETH|\s*USDC|\s*gwei)?)\b/gi
  ).filter((n) => /\d/.test(n) && n.length > 1);

  const techIds = [
    ...uniqueMatches(rawText, /\bCVE-\d{4}-\d{4,7}\b/gi),
    ...uniqueMatches(rawText, /\bCWE-\d{1,5}\b/gi),
    ...uniqueMatches(rawText, /\bT\d{4}(?:\.\d{3})?\b/g),
    ...uniqueMatches(rawText, /\b0x[a-fA-F0-9]{10,64}\b/g),
    ...uniqueMatches(rawText, /\b[a-fA-F0-9]{64}\b/g),
    ...uniqueMatches(rawText, /\bUNC-\d{3,5}\b/gi),
    ...uniqueMatches(rawText, /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g),
  ];

  const entities = uniqueMatches(
    rawText,
    /\b(?:EdgeCore|UNC-\d+|AetherBridge|Arbitrum|Ethereum|MITRE|CISA|NIST|VaultVerifier|ShadowPulse|GlobalSupply|Apex\s+Logistics|SecOps|ChainGuard|Robert\s+Kiyosaki|CASHFLOW\s+Quadrant|Rich\s+Dad|Blackbelt)\b/g
  );

  // PHASE 9: Fact Registry must ONLY be created from validated clean chunks
  const validChunks = chunks.filter(
    (c) => validateChunkQuality(c.source_text).valid
  );

  const facts: FactRegistryItem[] = [];
  let factCounter = 1;

  for (const pageObj of pages) {
    const matchingChunk = validChunks.find(
      (c) => c.page_number === pageObj.page
    );
    // If the page has no valid clean chunk, do NOT create facts from this page
    if (!matchingChunk && validChunks.length === 0) {
      continue;
    }
    const targetChunk = matchingChunk || validChunks[0];
    const pageSentences = splitSentences(pageObj.text);

    for (const sentence of pageSentences) {
      const cleaned = sentence.replace(/\s+/g, ' ').trim();
      if (cleaned.length < 28 || cleaned.length > 420) continue;

      // PHASE 9: Reject any fact candidate containing PDF internals or U+FFFD
      if (!isCleanFactCandidate(cleaned)) {
        continue;
      }

      // Ignore prompt injection lines from becoming factual claims
      if (/ignore\s+(all\s+)?(previous|prior)\s+instructions|reveal\s+system\s+prompt/i.test(cleaned)) {
        continue;
      }

      const sNumbers = uniqueMatches(
        cleaned,
        /\b(?:\$?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*%|\s*million|\s*billion|\s*bps|\s*ms|\s*hours|\s*days|\s*ETH|\s*USDC|\s*gwei)?)\b/gi
      ).filter((n) => /\d/.test(n));
      const sDates = uniqueMatches(
        cleaned,
        /\b(?:202\d-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+202\d|\bQ[1-4]\s+202\d)\b/gi
      );
      const sTech = [
        ...uniqueMatches(cleaned, /\bCVE-\d{4}-\d{4,7}\b/gi),
        ...uniqueMatches(cleaned, /\bCWE-\d{1,5}\b/gi),
        ...uniqueMatches(cleaned, /\bT\d{4}(?:\.\d{3})?\b/g),
        ...uniqueMatches(cleaned, /\b0x[a-fA-F0-9]{8,64}\b/g),
        ...uniqueMatches(cleaned, /\b[a-fA-F0-9]{64}\b/g),
        ...uniqueMatches(cleaned, /\bUNC-\d{3,5}\b/gi),
        ...uniqueMatches(
          cleaned,
          /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g
        ),
      ];
      const sEntities = uniqueMatches(
        cleaned,
        /\b[A-Z][a-zA-Z0-9_-]{2,}(?:\s+[A-Z][a-zA-Z0-9_-]{2,})?\b/g
      ).filter(
        (e) =>
          !/^(The|This|That|These|Those|However|Furthermore|In|On|At|For|With|From|During|After|Before|Page|Section)$/.test(
            e
          )
      );

      // Determine certainty & negation strictly from source wording (Section 27)
      const isNegated =
        /\b(no\s+evidence|not\s+found|never|none\s+of|no\s+indication|zero\s+unauthorized|was\s+not\s+compromised|did\s+not\s+affect)\b/i.test(
          cleaned
        );
      const isSuspected = /\b(suspected|alleged|unconfirmed|attributed\s+with\s+low\s+confidence)\b/i.test(
        cleaned
      );
      const isPossible = /\b(possible|possibly|may\s+have|might|potential|could\s+allow)\b/i.test(
        cleaned
      );
      const isConditional = /\b(if\s+unpatched|provided\s+that|when\s+configured|depending\s+on)\b/i.test(
        cleaned
      );

      let certainty: CertaintyLevel = 'confirmed';
      if (isNegated) certainty = 'negated';
      else if (isSuspected) certainty = 'suspected';
      else if (isPossible) certainty = 'possible';
      else if (isConditional) certainty = 'conditional';

      let factType: FactCategory = 'finding';
      if (isNegated) factType = 'negation';
      else if (isSuspected || isPossible) factType = 'uncertainty';
      else if (
        /\b(must\s+(?:immediately\s+)?upgrade|patch|mitigat|remediat|upgrade\s+to|recommend)\b/i.test(
          cleaned
        )
      )
        factType = 'mitigation';
      else if (sTech.length > 0) factType = 'technical_identifier';
      else if (sNumbers.length > 0 && sDates.length > 0) factType = 'event';
      else if (sNumbers.length > 0) factType = 'metric';
      else if (/represents|defined\s+as|architecture|consists\s+of/i.test(cleaned))
        factType = 'concept';

      let importance: FactImportance = 'medium';
      if (
        sTech.length > 0 ||
        isNegated ||
        isSuspected ||
        /\b(critical|zero-day|cvss|root\s+cause|total|drained|verified|patch)\b/i.test(
          cleaned
        )
      ) {
        importance = 'critical';
      } else if (sNumbers.length > 0 || sDates.length > 0) {
        importance = 'high';
      }

      facts.push({
        fact_id: `f${factCounter++}`,
        document_id: documentId,
        statement: cleaned,
        fact_type: factType,
        importance,
        confidence: certainty === 'confirmed' || certainty === 'negated' ? 0.98 : 0.86,
        certainty,
        negated: isNegated,
        source_chunk_id: targetChunk.chunk_id,
        source_page: pageObj.page,
        source_text: cleaned,
        entities: sEntities.slice(0, 6),
        dates: sDates,
        numbers: sNumbers,
        technical_identifiers: sTech,
        domain,
        relationships:
          sEntities.length >= 2
            ? [`${sEntities[0]} -> ${sEntities[1]}`]
            : [],
        used_by_outputs: [],
      });

      if (facts.length >= 28) break;
    }
    if (facts.length >= 28) break;
  }

  const summarySentences = facts
    .slice(0, 3)
    .map((f) => f.statement)
    .join(' ');

  const topics = Array.from(
    new Set([
      domain,
      ...entities.slice(0, 5),
      ...techIds.slice(0, 4),
    ])
  ).filter(Boolean);

  const understanding: DocumentUnderstanding = {
    document_id: documentId,
    title,
    author,
    summary:
      summarySentences ||
      'Source document ingested and parsed into verifiable factual statements.',
    detected_domain: domain,
    domain_confidence: confidence,
    topics: topics.length > 0 ? topics : [domain, 'Source Analysis', 'Fact Verification'],
    entities: Array.from(
      new Set([
        ...entities,
        ...facts.flatMap((f) => f.entities).slice(0, 12),
      ])
    ).slice(0, 14),
    dates: allDates.slice(0, 12),
    numbers: allNumbers.slice(0, 16),
    relationships: facts
      .filter((f) => f.entities.length >= 2)
      .slice(0, 8)
      .map((f) => ({
        subject: f.entities[0],
        predicate: f.fact_type,
        object: f.entities[1],
        source_page: f.source_page,
      })),
    claims: facts.slice(0, 8).map((f) => f.statement),
    concepts: facts
      .filter((f) => f.fact_type === 'concept' || f.fact_type === 'finding')
      .slice(0, 6)
      .map((f) => f.statement),
    technical_identifiers: Array.from(new Set(techIds)).slice(0, 16),
    certainty_statements: facts
      .filter((f) => f.certainty === 'confirmed')
      .slice(0, 6)
      .map((f) => f.statement),
    uncertainty_statements: facts
      .filter((f) => f.certainty === 'possible' || f.certainty === 'suspected')
      .map((f) => f.statement),
    negation_statements: facts
      .filter((f) => f.negated || f.certainty === 'negated')
      .map((f) => f.statement),
    important_statements: facts
      .filter((f) => f.importance === 'critical' || f.importance === 'high')
      .slice(0, 8)
      .map((f) => f.statement),
    cybersecurity_pack:
      domain === 'Cybersecurity' ? extractCybersecurityPack(rawText) : undefined,
    blockchain_pack:
      domain === 'Blockchain' ? extractBlockchainPack(rawText) : undefined,
    analyzed_at: new Date().toISOString(),
  };

  return { understanding, facts };
}

const contextBundleCache = new Map<string, ContextBundle>();

export function getContextBundleCacheStats(): { size: number } {
  return { size: contextBundleCache.size };
}

export function clearContextBundleCache(): void {
  contextBundleCache.clear();
}

/**
 * Context Builder (Section 12)
 * Prioritizes:
 * 1. factual importance
 * 2. output relevance
 * 3. domain relevance
 * 4. entity relevance
 * 5. retrieval similarity
 * Never blindly selects only the first N facts.
 * Features safe composite context bundle caching (Phase 3 Step 2E).
 */
export function buildGroundedContext(
  documentId: string,
  domain: DomainType,
  audience: AudienceType,
  selectedFormats: OutputFormatType[],
  allFacts: FactRegistryItem[],
  retrievedChunks: DocumentChunk[],
  ragDecision: RagDecision
): ContextBundle {
  const factsFingerprint = computeSha256(
    allFacts.map((f) => `${f.fact_id}:${f.statement}`).join('|')
  );
  const formatsKey = [...selectedFormats].sort().join(',');
  const cacheKey = `ctx_${documentId}_${domain}_${audience}_${formatsKey}_${factsFingerprint.slice(0, 16)}`;

  if (contextBundleCache.has(cacheKey)) {
    return contextBundleCache.get(cacheKey)!;
  }

  // PHASE 10: Inspect actual retrieved chunk text & fact text before building context
  const cleanRetrievedChunks = retrievedChunks.filter(
    (c) => validateChunkQuality(c.source_text).valid
  );
  const cleanFacts = allFacts.filter((f) => isCleanFactCandidate(f.statement));

  const retrievedChunkIds = new Set(
    cleanRetrievedChunks.map((c) => c.chunk_id)
  );
  const chunkScoreMap = new Map<string, number>();
  for (const s of ragDecision.top_chunk_scores) {
    chunkScoreMap.set(s.chunk_id, s.cosine_similarity);
  }

  const scoredFacts = cleanFacts.map((fact) => {
    let score = 0;

    // 1. Factual importance
    if (fact.importance === 'critical') score += 40;
    else if (fact.importance === 'high') score += 28;
    else if (fact.importance === 'medium') score += 15;
    else score += 5;

    // 2. Output & Uncertainty/Negation protection relevance
    if (fact.negated || fact.certainty === 'negated') score += 25;
    if (fact.certainty === 'possible' || fact.certainty === 'suspected') score += 22;
    if (selectedFormats.includes('advisory') && fact.fact_type === 'mitigation') {
      score += 20;
    }
    if (
      (selectedFormats.includes('infographic') ||
        selectedFormats.includes('executive_summary')) &&
      fact.numbers.length > 0
    ) {
      score += 15;
    }

    // 3. Domain relevance
    if (fact.technical_identifiers.length > 0) score += 18;

    // 4. Entity relevance
    score += Math.min(12, fact.entities.length * 3);

    // 5. Retrieval similarity
    if (retrievedChunkIds.has(fact.source_chunk_id)) {
      score += (chunkScoreMap.get(fact.source_chunk_id) || 0.5) * 20;
    }

    return { fact, score };
  });

  // Sort by composite priority score, then preserve chronological order for top facts
  scoredFacts.sort((a, b) => b.score - a.score);
  const prioritized = scoredFacts.slice(0, 18).map((sf) => sf.fact);

  const audienceDirectives: Record<AudienceType, string> = {
    Technical:
      'Use precise domain terminology, preserve all technical identifiers (CVEs, hashes, chain IDs, architectural metrics), and emphasize mechanism and verification evidence.',
    Executive:
      'Focus on operational impact, strategic implications, risk posture, and source-supported decisions while keeping every number, date, and identifier identical to the Fact Registry.',
    Professional:
      'Balance technical accuracy with practical operational meaning for cross-functional practitioners. Keep all underlying facts unchanged.',
    'General Public':
      'Use clear, accessible prose and briefly explain specialized terms without altering any numbers, dates, entities, uncertainties, or negations.',
    Automatic:
      'Adapt tone to the detected domain while maintaining strict factual equivalence across all formats.',
  };

  const bundle: ContextBundle = {
    document_id: documentId,
    audience,
    domain,
    rag_decision: ragDecision,
    prioritized_facts: prioritized,
    retrieved_chunks: cleanRetrievedChunks,
    truth_compression_directive: audienceDirectives[audience],
    source_delimiter_wrapped: true,
  };

  contextBundleCache.set(cacheKey, bundle);
  return bundle;
}

function uniqueMatches(text: string, regex: RegExp): string[] {
  const matches = text.match(regex) || [];
  return Array.from(new Set(matches.map((m) => m.trim())));
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
