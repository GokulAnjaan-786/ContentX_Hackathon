export type UserRole = 'Admin' | 'Editor' | 'Viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  organization: string;
  role: UserRole;
  created_at: string;
}

export type DomainType =
  | 'General'
  | 'Cybersecurity'
  | 'Blockchain'
  | 'Research'
  | 'Business'
  | 'Policy'
  | 'Education'
  | 'Custom';

export type AudienceType =
  | 'Technical'
  | 'Executive'
  | 'Professional'
  | 'General Public'
  | 'Automatic';

export type OutputFormatType =
  | 'linkedin'
  | 'twitter'
  | 'executive_summary'
  | 'advisory'
  | 'presentation'
  | 'infographic'
  | 'video_package';

export type ProcessingStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed';

export type ValidationGateStatus = 'PASSED' | 'WARNING' | 'FAILED';

export type CertaintyLevel =
  | 'confirmed'
  | 'possible'
  | 'suspected'
  | 'conditional'
  | 'negated';

export type FactImportance = 'critical' | 'high' | 'medium' | 'low';

export type FactCategory =
  | 'concept'
  | 'metric'
  | 'event'
  | 'finding'
  | 'technical_identifier'
  | 'uncertainty'
  | 'negation'
  | 'relationship'
  | 'mitigation';

export interface SourceQualityMetrics {
  passed: boolean;
  quality_score: number; // 0 - 100
  extracted_characters: number;
  printable_char_ratio: number;
  replacement_char_count: number;
  replacement_char_ratio: number;
  alphabetic_char_ratio: number;
  whitespace_ratio: number;
  pdf_artifact_count: number;
  pdf_artifacts_detected: string[];
  average_token_readability: number;
  repeated_binary_patterns: number;
  valid_chunks_count: number;
  invalid_chunks_count: number;
  failure_reason?: string;
}

export interface ForensicReprocessReport {
  document_id: string;
  filename: string;
  corrupted_chunks_invalidated: number;
  corrupted_embeddings_invalidated: number;
  corrupted_facts_invalidated: number;
  corrupted_outputs_invalidated: number;
  clean_pages_extracted: number;
  clean_chunks_rebuilt: number;
  clean_embeddings_regenerated: number;
  clean_facts_rebuilt: number;
  clean_outputs_regenerated: number;
  status: 'REPROCESSED_CLEAN' | 'CLEAN_NO_ACTION_NEEDED' | 'REJECTED_CORRUPT_SOURCE';
  timestamp: string;
}

export interface SecurityScanResult {
  passed: boolean;
  extension_valid: boolean;
  mime_valid: boolean;
  size_valid: boolean;
  malware_signature_clean: boolean;
  prompt_injection_detected: boolean;
  prompt_injection_patterns: string[];
  prompt_injection_neutralized: boolean;
  pii_detected: boolean;
  pii_types: string[];
  scan_timestamp: string;
}

export interface CybersecurityDomainExtract {
  incident?: string;
  threat_actors: string[];
  malware: string[];
  cves: string[];
  cwes: string[];
  cvss_scores: string[];
  iocs: {
    ips: string[];
    domains: string[];
    urls: string[];
    hashes: string[];
    files: string[];
  };
  campaigns: string[];
  attack_techniques: string[];
  affected_products: string[];
  affected_versions: string[];
  attack_vectors: string[];
  impact: string[];
  mitigation: string[];
  detection: string[];
  timeline: string[];
  severity: string;
  status: string;
}

export interface BlockchainDomainExtract {
  blockchain_networks: string[];
  chain_ids: string[];
  block_numbers: string[];
  transaction_hashes: string[];
  wallet_addresses: string[];
  contract_addresses: string[];
  tokens: string[];
  nfts: string[];
  smart_contracts: string[];
  events: string[];
  transactions: string[];
  gas_metrics: string[];
  nonces: string[];
  timestamps: string[];
  block_hashes: string[];
  validators: string[];
  protocols: string[];
  bridges: string[];
  network_status: string;
  confirmation_status: string;
}

export interface DocumentUnderstanding {
  document_id: string;
  title: string;
  author: string;
  summary: string;
  detected_domain: DomainType;
  domain_confidence: number;
  topics: string[];
  entities: string[];
  dates: string[];
  numbers: string[];
  relationships: Array<{
    subject: string;
    predicate: string;
    object: string;
    source_page: number;
  }>;
  claims: string[];
  concepts: string[];
  technical_identifiers: string[];
  certainty_statements: string[];
  uncertainty_statements: string[];
  negation_statements: string[];
  important_statements: string[];
  cybersecurity_pack?: CybersecurityDomainExtract;
  blockchain_pack?: BlockchainDomainExtract;
  analyzed_at: string;
}

export interface DocumentChunk {
  chunk_id: string;
  document_id: string;
  page_number: number;
  chunk_index: number;
  word_count: number;
  source_text: string;
  embedding_model: string;
  embedding_dim: number;
  embedding_preview: number[]; // First 8 dims for inspection, full 1024-dim in server store
}

export interface FactRegistryItem {
  fact_id: string;
  document_id: string;
  statement: string;
  fact_type: FactCategory;
  importance: FactImportance;
  confidence: number;
  certainty: CertaintyLevel;
  negated: boolean;
  source_chunk_id: string;
  source_page: number;
  source_text: string;
  entities: string[];
  dates: string[];
  numbers: string[];
  technical_identifiers: string[];
  domain: DomainType;
  relationships: string[];
  used_by_outputs: OutputFormatType[];
}

export interface RagDecision {
  rag_required: boolean;
  strategy: 'DIRECT_UNDERSTANDING_PLUS_FACT_REGISTRY' | 'SELECTIVE_VECTOR_RAG';
  reason: string;
  document_words: number;
  threshold_words: number;
  chunks_total: number;
  chunks_retrieved: number;
  embedding_model: string;
  embedding_dim: number;
  similarity_metric: 'cosine';
  top_chunk_scores: Array<{
    chunk_id: string;
    page_number: number;
    cosine_similarity: number;
  }>;
}

export interface ContextBundle {
  document_id: string;
  audience: AudienceType;
  domain: DomainType;
  rag_decision: RagDecision;
  prioritized_facts: FactRegistryItem[];
  retrieved_chunks: DocumentChunk[];
  truth_compression_directive: string;
  source_delimiter_wrapped: boolean;
}

export interface LinkedInOutput {
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  fact_ids_used: string[];
}

export interface TwitterOutput {
  thread: Array<{
    order: number;
    text: string;
  }>;
  fact_ids_used: string[];
}

export interface ExecutiveSummaryOutput {
  title: string;
  summary: string;
  key_points: string[];
  fact_ids_used: string[];
}

export interface AdvisoryOutput {
  title: string;
  executive_summary: string;
  key_findings: string[];
  impact: string;
  recommendations: string[];
  risk: string;
  fact_ids_used: string[];
}

export interface PresentationSlide {
  slide_number: number;
  title: string;
  content: string;
  key_points: string[];
  visual_suggestion: string;
  fact_ids_used: string[];
}

export interface PresentationOutput {
  title: string;
  slides: PresentationSlide[];
  fact_ids_used: string[];
}

export interface InfographicSection {
  heading: string;
  content: string;
  key_statements: string[];
  fact_ids_used: string[];
}

export interface InfographicOutput {
  title: string;
  subtitle: string;
  sections: InfographicSection[];
  layout_style: string;
  colour_theme: string;
  fact_ids_used: string[];
}

export interface VideoScene {
  scene_number: number;
  duration: string;
  narration: string;
  visual_description: string;
  on_screen_text: string;
  fact_ids_used: string[];
}

export interface VideoPackageOutput {
  title: string;
  duration: string;
  scenes: VideoScene[];
  cta: string;
  fact_ids_used: string[];
}

export type StructuredOutputContent =
  | LinkedInOutput
  | TwitterOutput
  | ExecutiveSummaryOutput
  | AdvisoryOutput
  | PresentationOutput
  | InfographicOutput
  | VideoPackageOutput;

export interface OutputClaim {
  claim_id: string;
  output_id: string;
  format: OutputFormatType;
  claim_text: string;
  fact_id: string;
  fact_statement: string;
  source_chunk_id: string;
  source_page: number;
  source_text: string;
  certainty: CertaintyLevel;
  validation_status: 'SOURCE-SUPPORTED' | 'UNCERTAINTY-PRESERVED' | 'NEGATION-PRESERVED' | 'UNSUPPORTED';
}

export interface ValidationGateDetail {
  gate_id: string;
  name: string;
  status: ValidationGateStatus;
  message: string;
}

export interface ValidationResult {
  validation_id: string;
  output_id: string;
  document_id: string;
  format: OutputFormatType;
  overall_status: ValidationGateStatus;
  score: number; // 0-100
  gates: {
    json_validation: ValidationGateDetail;
    schema_validation: ValidationGateDetail;
    required_fields: ValidationGateDetail;
    fact_id_validation: ValidationGateDetail;
    source_grounding: ValidationGateDetail;
    unsupported_claim_detection: ValidationGateDetail;
    hallucination_detection: ValidationGateDetail;
    number_consistency: ValidationGateDetail;
    date_consistency: ValidationGateDetail;
    entity_consistency: ValidationGateDetail;
    uncertainty_preservation: ValidationGateDetail;
    negation_preservation: ValidationGateDetail;
    cross_output_consistency: ValidationGateDetail;
    prompt_leakage_detection: ValidationGateDetail;
    placeholder_detection: ValidationGateDetail;
    security_and_pii: ValidationGateDetail;
  };
  unsupported_claims: string[];
  retry_count: number;
  validated_at: string;
}

export interface GeneratedOutputRecord {
  output_id: string;
  job_id: string;
  document_id: string;
  format: OutputFormatType;
  audience: AudienceType;
  status: ProcessingStatus;
  content: StructuredOutputContent | null;
  fact_ids_used: string[];
  claims: OutputClaim[];
  validation: ValidationResult;
  output_fingerprint: string;
  model_used: string;
  prompt_version: string;
  generation_latency_ms: number;
  failure_reason?: string;
  created_at: string;
  verification_id: string;
}

export interface ProvenanceRecord {
  provenance_id: string;
  verification_id: string;
  document_id: string;
  document_name: string;
  document_fingerprint: string;
  output_id: string;
  output_format: OutputFormatType;
  output_fingerprint: string;
  audience: AudienceType;
  domain: DomainType;
  issuer: string;
  created_at: string;
  model: string;
  prompt_version: string;
  fact_ids: string[];
  validation_status: ValidationGateStatus;
  validation_score: number;
  fact_traceability: 'VERIFIED' | 'UNVERIFIED';
  approval_status: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED';
  is_demo: boolean;
  blockchain_anchor?: {
    enabled: boolean;
    status: 'MODULAR_NOT_ANCHORED' | 'ANCHORED';
    network?: string;
    transaction_hash?: string;
    block_number?: number;
    timestamp?: string;
  };
}

export interface VerificationLookupResult {
  verification_id: string;
  status: 'AUTHENTIC' | 'INVALID' | 'MODIFIED';
  provenance: ProvenanceRecord | null;
  output: GeneratedOutputRecord | null;
  document: SourceDocument | null;
  integrity_check: {
    document_hash_match: boolean;
    output_hash_match: boolean;
    computed_output_hash: string;
    expected_output_hash: string;
    checked_at: string;
  };
}

export interface SourceDocument {
  document_id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  pages: number;
  word_count: number;
  upload_date: string;
  sha256_fingerprint: string;
  processing_status: ProcessingStatus;
  detected_domain: DomainType;
  raw_text: string;
  page_texts: Array<{ document_id?: string; page: number; page_number?: number; text: string }>;
  security_scan: SecurityScanResult;
  source_quality?: SourceQualityMetrics;
  extraction_failure_reason?: string;
  understanding?: DocumentUnderstanding;
  rag_decision?: RagDecision;
  facts_count: number;
  outputs_count: number;
  uploaded_by: string;
  is_demo: boolean;
}

export interface GenerationJob {
  job_id: string;
  document_id: string;
  document_name: string;
  domain: DomainType;
  audience: AudienceType;
  selected_formats: OutputFormatType[];
  execution_mode: 'sequential' | 'parallel';
  status: ProcessingStatus;
  current_step: string;
  completed_formats: OutputFormatType[];
  failed_formats: OutputFormatType[];
  output_ids: string[];
  model: string;
  total_latency_ms: number;
  created_at: string;
  completed_at?: string;
  is_demo: boolean;
}

export interface AnalyticsSummary {
  has_data: boolean;
  include_demo: boolean;
  documents_processed: number;
  facts_extracted: number;
  outputs_generated: number;
  verified_outputs: number;
  average_validation_score: number;
  grounding_rate: number;
  failed_outputs: number;
  average_latency_ms: number;
  domain_distribution: Record<string, number>;
  output_distribution: Record<string, number>;
  audience_distribution: Record<string, number>;
}

export interface ProviderConfigStatus {
  generation_provider: 'ollama_local' | 'gemini_server_grounded' | 'deterministic_compiler';
  ollama_url: string;
  ollama_connected: boolean;
  ollama_generation_model: string;
  ollama_embedding_model: string;
  embedding_dimension: number;
  execution_mode: 'sequential' | 'parallel';
  num_ctx: number;
  temperature: number;
  gemini_configured: boolean;
  pgvector_mode: string;
  chunk_target_words: number;
  chunk_overlap_words: number;
  openrouter_disabled: true;
}
