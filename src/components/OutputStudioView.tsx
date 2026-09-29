import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  FileDown,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  AdvisoryOutput,
  ExecutiveSummaryOutput,
  FactRegistryItem,
  GeneratedOutputRecord,
  InfographicOutput,
  LinkedInOutput,
  OutputClaim,
  OutputFormatType,
  PresentationOutput,
  SourceDocument,
  TwitterOutput,
  VideoPackageOutput,
} from '../types/contentx.ts';

interface OutputStudioViewProps {
  outputs: GeneratedOutputRecord[];
  documents: SourceDocument[];
  factsByDoc: Record<string, FactRegistryItem[]>;
  selectedDocId: string;
  authToken?: string | null;
  onSelectDocId: (id: string) => void;
  onInspectClaim: (claim: OutputClaim, doc: SourceDocument | null) => void;
  onInspectFactId: (factId: string, docId: string) => void;
  onOpenVerify: (verificationId: string) => void;
  onOutputUpdated: (updated: GeneratedOutputRecord) => void;
}

const FORMAT_LABELS: Record<OutputFormatType, string> = {
  linkedin: 'LinkedIn',
  twitter: 'Twitter/X',
  executive_summary: 'Executive',
  advisory: 'Advisory',
  presentation: 'Presentation',
  infographic: 'Infographic',
  video_package: 'Video',
};

const ALL_FORMATS: OutputFormatType[] = [
  'linkedin',
  'twitter',
  'executive_summary',
  'advisory',
  'presentation',
  'infographic',
  'video_package',
];

export const OutputStudioView: React.FC<OutputStudioViewProps> = ({
  outputs,
  documents,
  selectedDocId,
  authToken,
  onSelectDocId,
  onInspectClaim,
  onInspectFactId,
  onOpenVerify,
  onOutputUpdated,
}) => {
  const [activeFormat, setActiveFormat] =
    useState<OutputFormatType>('linkedin');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editJsonText, setEditJsonText] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const filteredOutputs = outputs.filter((o) =>
    selectedDocId === 'all' ? true : o.document_id === selectedDocId
  );

  const availableFormatsForSelection = ALL_FORMATS.filter((fmt) =>
    filteredOutputs.some((o) => o.format === fmt)
  );

  const effectiveFormat = availableFormatsForSelection.includes(activeFormat)
    ? activeFormat
    : availableFormatsForSelection[0] || 'linkedin';

  const currentOutput =
    filteredOutputs.find((o) => o.format === effectiveFormat) ||
    filteredOutputs[0] ||
    null;

  const currentDoc = currentOutput
    ? documents.find((d) => d.document_id === currentOutput.document_id) || null
    : null;

  const handleCopy = (out: GeneratedOutputRecord) => {
    const text = formatOutputAsMarkdown(out, currentDoc?.filename || '');
    navigator.clipboard.writeText(text);
    setCopiedId(out.output_id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleDownloadJson = (out: GeneratedOutputRecord) => {
    const payload = {
      output_id: out.output_id,
      verification_id: out.verification_id,
      document_id: out.document_id,
      format: out.format,
      audience: out.audience,
      output_fingerprint: out.output_fingerprint,
      model_used: out.model_used,
      prompt_version: out.prompt_version,
      validation: out.validation,
      content: out.content,
      claims: out.claims,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ContentX_${out.format}_${out.output_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMarkdown = (out: GeneratedOutputRecord) => {
    const md = formatOutputAsMarkdown(out, currentDoc?.filename || 'Source');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ContentX_${out.format}_${out.output_id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startEditing = (out: GeneratedOutputRecord) => {
    setEditJsonText(JSON.stringify(out.content, null, 2));
    setEditError(null);
    setIsEditing(true);
  };

  const saveEditAndRevalidate = async () => {
    if (!currentOutput) return;
    setEditError(null);
    setSavingEdit(true);
    try {
      const parsed = JSON.parse(editJsonText);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      const res = await fetch(`/api/outputs/${currentOutput.output_id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ content: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update output');
      onOutputUpdated(data.output);
      setIsEditing(false);
    } catch (err: any) {
      setEditError(err.message || 'Invalid JSON structure');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Document Filter & Format Tabs */}
      <div className="flex flex-col gap-4 border border-slate-200 bg-white p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Output Studio & Claim Traceability Center
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Inspect source-grounded outputs, click any claim to trace its exact
            Fact Registry entry and source page, or export verified packages.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium text-slate-600">
            Source Document:
          </label>
          <select
            value={selectedDocId}
            onChange={(e) => onSelectDocId(e.target.value)}
            className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
          >
            <option value="all">All Processed Documents</option>
            {documents.map((doc) => (
              <option key={doc.document_id} value={doc.document_id}>
                {doc.is_demo ? '[DEMO DATA] ' : ''}
                {doc.filename} ({doc.detected_domain})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 7 Format Tabs (Segmented Interactive Controls) */}
      <div className="flex flex-wrap items-center gap-1 border border-slate-200 bg-slate-100 p-1">
        {ALL_FORMATS.map((fmt) => {
          const hasOutput = filteredOutputs.some((o) => o.format === fmt);
          const isActive = effectiveFormat === fmt;
          return (
            <button
              key={fmt}
              type="button"
              onClick={() => {
                setActiveFormat(fmt);
                setIsEditing(false);
              }}
              className={`px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-slate-900 text-white'
                  : hasOutput
                  ? 'bg-white text-slate-800 hover:bg-slate-50'
                  : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              {FORMAT_LABELS[fmt]}
              {hasOutput ? ' · Ready' : ''}
            </button>
          );
        })}
      </div>

      {!currentOutput ? (
        <div className="border border-slate-200 bg-white p-12 text-center">
          <div className="text-sm font-semibold text-slate-900">
            No generated output available for this selection
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Open the Transform Workspace to select output formats and run
            sequential source-grounded generation.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left 8 Columns: Structured Output Content & Clickable Claims */}
          <div className="space-y-6 lg:col-span-8">
            <div className="border border-slate-200 bg-white">
              {/* Output Header Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 font-mono tabular-nums">
                  <span className="font-semibold text-slate-900">
                    {FORMAT_LABELS[currentOutput.format].toUpperCase()}
                  </span>
                  <span>·</span>
                  <span>Audience: {currentOutput.audience}</span>
                  <span>·</span>
                  <span>
                    Validation: {currentOutput.validation.overall_status} (
                    {currentOutput.validation.score}%)
                  </span>
                  {currentDoc?.is_demo && (
                    <>
                      <span>·</span>
                      <span className="font-semibold text-amber-700">
                        DEMO DATA
                      </span>
                    </>
                  )}
                </div>

                {/* Action Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(currentOutput)}
                    className="flex items-center gap-1.5 border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                  >
                    {copiedId === currentOutput.output_id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadJson(currentOutput)}
                    className="flex items-center gap-1.5 border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Download JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportMarkdown(currentOutput)}
                    className="flex items-center gap-1.5 border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    <span>Export MD</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => startEditing(currentOutput)}
                    className="flex items-center gap-1.5 border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenVerify(currentOutput.verification_id)}
                    className="flex items-center gap-1.5 bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Verify Provenance</span>
                  </button>
                </div>
              </div>

              {/* Edit Mode vs Structured Render */}
              {isEditing ? (
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">
                      Edit Structured JSON Output (Re-runs 15-Point Validation on Save)
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                  {editError && (
                    <div className="border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      {editError}
                    </div>
                  )}
                  <textarea
                    rows={14}
                    value={editJsonText}
                    onChange={(e) => setEditJsonText(e.target.value)}
                    className="w-full border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={saveEditAndRevalidate}
                      disabled={savingEdit}
                      className="bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                    >
                      {savingEdit
                        ? 'Re-Validating...'
                        : 'Save & Run 15-Point Validation'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-6">
                  {renderStructuredFormat(currentOutput)}
                </div>
              )}

              {/* Referenced Fact Registry IDs Bar */}
              <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-slate-700">
                    Fact IDs Used (Click to inspect source page):
                  </span>
                  {currentOutput.fact_ids_used.map((fid) => (
                    <button
                      key={fid}
                      type="button"
                      onClick={() =>
                        onInspectFactId(fid, currentOutput.document_id)
                      }
                      className="border border-slate-300 bg-white px-2 py-0.5 font-mono text-xs font-medium text-blue-700 hover:border-blue-600 hover:bg-blue-50 tabular-nums whitespace-nowrap"
                    >
                      {fid}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Interactive Claim Traceability List (Section 26 & 40) */}
            <div className="border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Interactive Claim Traceability Inspector
                  </h2>
                  <p className="text-xs text-slate-500">
                    Click any generated claim below to inspect its mapped Fact ID,
                    Source Chunk, Page Number, and Exact Source Text.
                  </p>
                </div>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {currentOutput.claims.length} Verifiable Claims
                </span>
              </div>

              <div className="mt-3 divide-y divide-slate-200">
                {currentOutput.claims.map((claim) => (
                  <button
                    key={claim.claim_id}
                    type="button"
                    onClick={() => onInspectClaim(claim, currentDoc)}
                    className="flex w-full items-start justify-between gap-4 py-3 text-left transition-colors hover:bg-slate-50 px-2"
                  >
                    <div className="space-y-1">
                      <p className="text-sm text-slate-900">
                        {claim.claim_text}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                        <span className="font-semibold text-blue-700">
                          Fact: {claim.fact_id}
                        </span>
                        <span>·</span>
                        <span>Source: Page {claim.source_page}</span>
                        <span>·</span>
                        <span>Chunk: {claim.source_chunk_id}</span>
                        <span>·</span>
                        <span>Certainty: {claim.certainty}</span>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-semibold text-emerald-700 whitespace-nowrap">
                      {claim.validation_status} →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right 4 Columns: 15-Point Validation Center (Section 25 & 41) */}
          <div className="space-y-6 lg:col-span-4">
            <div className="border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    15-Point Validation Center
                  </h2>
                  <p className="text-xs text-slate-500 font-mono tabular-nums">
                    Output ID: {currentOutput.output_id}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-xs font-semibold tabular-nums">
                  {currentOutput.validation.overall_status === 'PASSED' ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span className="text-emerald-700">
                        PASSED ({currentOutput.validation.score}%)
                      </span>
                    </>
                  ) : currentOutput.validation.overall_status === 'WARNING' ? (
                    <>
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <span className="text-amber-700">
                        WARNING ({currentOutput.validation.score}%)
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-600" />
                      <span className="text-red-700">
                        FAILED ({currentOutput.validation.score}%)
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-3 divide-y divide-slate-100">
                {Object.values(currentOutput.validation.gates).map((gate) => (
                  <div
                    key={gate.gate_id}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <div>
                      <div className="text-xs font-medium text-slate-900">
                        {gate.name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {gate.message}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 font-mono text-xs font-semibold whitespace-nowrap ${
                        gate.status === 'PASSED'
                          ? 'text-emerald-700'
                          : gate.status === 'WARNING'
                          ? 'text-amber-700'
                          : 'text-red-700'
                      }`}
                    >
                      {gate.status}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500 font-mono tabular-nums space-y-1">
                <div>Model: {currentOutput.model_used}</div>
                <div>Prompt Version: {currentOutput.prompt_version}</div>
                <div>
                  Output SHA-256: {currentOutput.output_fingerprint.slice(0, 20)}...
                </div>
                <div>
                  Verification ID: {currentOutput.verification_id}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function renderInlineFormattedText(text: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-semibold text-slate-950">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function renderStructuredFormat(output: GeneratedOutputRecord) {
  if (!output.content) {
    return (
      <div className="text-sm text-red-600">
        Generation failed: {output.failure_reason || 'Invalid output contract'}
      </div>
    );
  }

  switch (output.format) {
    case 'linkedin': {
      const c = output.content as LinkedInOutput;
      const paragraphs = c.body.split(/\n\n+/).filter(Boolean);
      return (
        <div className="space-y-5">
          <div className="border-l-2 border-slate-900 pl-4">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Thought-Leadership Hook
            </div>
            <p className="mt-1 text-base font-semibold leading-snug text-slate-950">
              {renderInlineFormattedText(c.hook)}
            </p>
          </div>
          <div className="space-y-3.5">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Narrative Body (Context → Insight → Evidence → Takeaway)
            </div>
            {paragraphs.map((para, pIdx) => (
              <div
                key={pIdx}
                className="whitespace-pre-line text-sm leading-relaxed text-slate-800"
              >
                {renderInlineFormattedText(para)}
              </div>
            ))}
          </div>
          <div className="border-t border-slate-200 bg-slate-50/70 p-3.5">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Audience Call to Action (CTA)
            </div>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {renderInlineFormattedText(c.cta)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1 font-mono text-xs font-medium text-blue-700">
            {c.hashtags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>
      );
    }

    case 'twitter': {
      const c = output.content as TwitterOutput;
      const roleLabels = [
        '01 · Hook',
        '02 · Context',
        '03 · Core Evidence',
        '04 · Implication & Boundary',
        '05 · Takeaway',
      ];
      return (
        <div className="space-y-3">
          {c.thread.map((tweet, idx) => (
            <div
              key={tweet.order}
              className="border border-slate-200 bg-slate-50/50 p-4"
            >
              <div className="flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
                <span className="font-semibold text-slate-800">
                  Tweet #{tweet.order} —{' '}
                  {roleLabels[idx] || `Part ${tweet.order}`}
                </span>
                <span>{tweet.text.length} / 280 chars</span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-900">
                {renderInlineFormattedText(tweet.text)}
              </p>
            </div>
          ))}
        </div>
      );
    }

    case 'executive_summary': {
      const c = output.content as ExecutiveSummaryOutput;
      const summaryBlocks = c.summary.split(/\n\n+/).filter(Boolean);
      return (
        <div className="space-y-5">
          <div className="border-b border-slate-200 pb-3">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Leadership Decision Brief
            </div>
            <h3 className="mt-1 text-lg font-semibold text-slate-950">
              {c.title}
            </h3>
          </div>
          <div className="space-y-3 border border-slate-200 bg-slate-50/60 p-4">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Executive Overview, Strategic Implication & Source Basis
            </div>
            {summaryBlocks.map((blk, idx) => (
              <p
                key={idx}
                className="text-sm leading-relaxed text-slate-800"
              >
                {renderInlineFormattedText(blk)}
              </p>
            ))}
          </div>
          <div>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Prioritized Key Findings (High Importance First)
            </div>
            <ul className="mt-2.5 space-y-2.5">
              {c.key_points.map((pt, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 border-l-2 border-slate-300 pl-3 text-sm leading-relaxed text-slate-800"
                >
                  <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums mt-0.5">
                    0{i + 1}.
                  </span>
                  <span>{renderInlineFormattedText(pt)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    }

    case 'advisory': {
      const c = output.content as AdvisoryOutput;
      const execParagraphs = c.executive_summary.split(/\n\n+/).filter(Boolean);
      return (
        <div className="space-y-5">
          <div className="border-b border-slate-200 pb-3">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Principal Consultant & Domain Advisory
            </div>
            <h3 className="mt-1 text-lg font-semibold text-slate-950">
              {c.title}
            </h3>
          </div>
          <div className="space-y-2.5">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Situation & Executive Assessment
            </div>
            {execParagraphs.map((p, idx) => (
              <p key={idx} className="text-sm leading-relaxed text-slate-800">
                {renderInlineFormattedText(p)}
              </p>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="border border-slate-200 bg-slate-50 p-4">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Operational Impact (Source-Verified)
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-900">
                {renderInlineFormattedText(c.impact)}
              </p>
            </div>
            <div className="border border-slate-200 bg-slate-50 p-4">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Risk & Consideration Boundaries
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-900">
                {renderInlineFormattedText(c.risk)}
              </p>
            </div>
          </div>
          <div>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Prioritized Key Findings
            </div>
            <ul className="mt-2 space-y-2 text-sm text-slate-800">
              {c.key_findings.map((kf, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums mt-0.5">
                    0{i + 1}.
                  </span>
                  <span>{renderInlineFormattedText(kf)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-slate-200 pt-4">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Recommended Response (Source-Derived vs. ContentX Interpretation)
            </div>
            <ul className="mt-2 space-y-2 text-sm text-slate-800">
              {c.recommendations.map((rec, i) => {
                const isInterpretation = /ContentX Interpretation/i.test(rec);
                return (
                  <li
                    key={i}
                    className={`flex items-start gap-2.5 p-2.5 border ${
                      isInterpretation
                        ? 'border-amber-200 bg-amber-50/50 text-slate-800'
                        : 'border-slate-200 bg-white text-slate-900'
                    }`}
                  >
                    <span className="font-mono text-xs font-semibold text-blue-700 tabular-nums mt-0.5">
                      R{i + 1}.
                    </span>
                    <span>{renderInlineFormattedText(rec)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      );
    }

    case 'presentation': {
      const c = output.content as PresentationOutput;
      return (
        <div className="space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Executive Presentation Storyboard (One Clear Purpose Per Slide)
            </div>
            <h3 className="mt-1 text-base font-semibold text-slate-950">
              {c.title}
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {c.slides.map((slide) => (
              <div
                key={slide.slide_number}
                className="border border-slate-200 bg-slate-50/40 p-4"
              >
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-sm font-semibold text-slate-900">
                    Slide {slide.slide_number}: {slide.title}
                  </span>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    Facts: {slide.fact_ids_used.join(', ')}
                  </span>
                </div>
                <p className="mt-2.5 text-sm font-medium text-slate-900">
                  {renderInlineFormattedText(slide.content)}
                </p>
                <ul className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-slate-700">
                  {slide.key_points.map((kp, idx) => (
                    <li key={idx}>• {renderInlineFormattedText(kp)}</li>
                  ))}
                </ul>
                <div className="mt-3 border-t border-slate-200/80 pt-2 font-mono text-xs text-slate-600">
                  Visual Presentation Architecture: {slide.visual_suggestion}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'infographic': {
      const c = output.content as InfographicOutput;
      return (
        <div className="space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="text-lg font-semibold text-slate-950">{c.title}</h3>
            <p className="mt-0.5 text-xs font-medium text-slate-600">
              {c.subtitle}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500 font-mono">
              <span>Visual Structure: {c.layout_style}</span>
              <span>·</span>
              <span>Palette: {c.colour_theme}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {c.sections.map((sec, idx) => (
              <div
                key={idx}
                className="border border-slate-200 bg-slate-50/50 p-4"
              >
                <div className="flex items-center justify-between border-b border-slate-200/70 pb-2">
                  <h4 className="text-sm font-semibold text-slate-900">
                    {sec.heading}
                  </h4>
                  <span className="font-mono text-xs text-slate-500">
                    Facts: {sec.fact_ids_used.join(', ')}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {renderInlineFormattedText(sec.content)}
                </p>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-700">
                  {sec.key_statements.map((ks, j) => (
                    <li key={j}>• {renderInlineFormattedText(ks)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'video_package': {
      const c = output.content as VideoPackageOutput;
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Spoken-Aloud Narrative Storyboard
              </div>
              <h3 className="mt-0.5 text-base font-semibold text-slate-950">
                {c.title}
              </h3>
            </div>
            <span className="font-mono text-xs text-slate-600 tabular-nums">
              Duration: {c.duration}
            </span>
          </div>
          <div className="space-y-3">
            {c.scenes.map((scene) => (
              <div
                key={scene.scene_number}
                className="border border-slate-200 bg-slate-50/40 p-4"
              >
                <div className="flex items-center justify-between text-xs font-mono text-slate-500 tabular-nums border-b border-slate-200/70 pb-2">
                  <span className="font-semibold text-slate-900">
                    Scene {scene.scene_number} ({scene.duration})
                  </span>
                  <span>Facts: {scene.fact_ids_used.join(', ')}</span>
                </div>
                <div className="mt-2.5 space-y-2 text-sm">
                  <div>
                    <span className="font-mono text-xs font-semibold text-slate-500">
                      Spoken Narration:{' '}
                    </span>
                    <span className="leading-relaxed text-slate-900">
                      {renderInlineFormattedText(scene.narration)}
                    </span>
                  </div>
                  <div>
                    <span className="font-mono text-xs font-semibold text-slate-500">
                      On-Screen Text:{' '}
                    </span>
                    <span className="font-mono text-xs font-medium text-blue-800">
                      {scene.on_screen_text}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">
                    <span className="font-mono font-semibold text-slate-500">
                      Visual Direction:{' '}
                    </span>
                    {scene.visual_description}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-200 pt-3 text-xs font-medium text-slate-900">
            Closing CTA: {c.cta}
          </div>
        </div>
      );
    }
  }
}

function formatOutputAsMarkdown(
  out: GeneratedOutputRecord,
  docName: string
): string {
  return [
    `# ContentX Verified Output (${out.format.toUpperCase()})`,
    `- Source Document: ${docName}`,
    `- Output ID: ${out.output_id}`,
    `- Verification ID: ${out.verification_id}`,
    `- Output SHA-256: ${out.output_fingerprint}`,
    `- Audience: ${out.audience}`,
    `- Validation: ${out.validation.overall_status} (${out.validation.score}%)`,
    `- Fact IDs Used: ${out.fact_ids_used.join(', ')}`,
    '',
    '## Structured Content',
    '```json',
    JSON.stringify(out.content, null, 2),
    '```',
  ].join('\n');
}
