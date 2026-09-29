import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  ProvenanceRecord,
  UserRole,
  VerificationLookupResult,
} from '../types/contentx.ts';

interface VerificationAndProvenanceViewProps {
  mode: 'verify' | 'provenance';
  provenanceList: ProvenanceRecord[];
  initialVerificationId: string;
  userRole: UserRole;
  onSelectVerificationId: (id: string) => void;
  onRefreshProvenance: () => void;
}

export const VerificationAndProvenanceView: React.FC<
  VerificationAndProvenanceViewProps
> = ({
  mode,
  provenanceList,
  initialVerificationId,
  userRole,
  onSelectVerificationId,
  onRefreshProvenance,
}) => {
  const [lookupInput, setLookupInput] = useState(
    initialVerificationId || provenanceList[0]?.verification_id || ''
  );
  const [lookupResult, setLookupResult] =
    useState<VerificationLookupResult | null>(null);
  const [tamperPayload, setTamperPayload] = useState('');
  const [isTamperTesting, setIsTamperTesting] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialVerificationId) {
      setLookupInput(initialVerificationId);
      performVerification(initialVerificationId);
    } else if (provenanceList.length > 0 && !lookupResult) {
      const defaultId = provenanceList[0].verification_id;
      setLookupInput(defaultId);
      performVerification(defaultId);
    }
  }, [initialVerificationId, provenanceList.length]);

  const performVerification = async (
    verificationId: string,
    customTamperText?: string
  ) => {
    if (!verificationId.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/verification/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verificationId: verificationId.trim(),
          testPayload: customTamperText,
        }),
      });
      const data = (await res.json()) as VerificationLookupResult;
      setLookupResult(data);
      if (!customTamperText && data.output?.content) {
        setTamperPayload(JSON.stringify(data.output.content, null, 2));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateApproval = async (
    verificationId: string,
    approvalStatus: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED'
  ) => {
    await fetch('/api/provenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verificationId, approvalStatus }),
    });
    onRefreshProvenance();
    if (lookupInput === verificationId) {
      performVerification(verificationId);
    }
  };

  if (mode === 'provenance') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Cryptographic Provenance & Attestation Ledger
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Immutable SHA-256 lineage binding every generated format to its
              source document fingerprint, model configuration, and Fact
              Registry IDs.
            </p>
          </div>
          <div className="font-mono text-xs text-slate-600 tabular-nums">
            Total Provenance Records: {provenanceList.length}
          </div>
        </div>

        <div className="border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Verification ID</th>
                <th className="py-3 px-4">Source Document</th>
                <th className="py-3 px-4">Format & Audience</th>
                <th className="py-3 px-4">Document SHA-256</th>
                <th className="py-3 px-4">Output SHA-256</th>
                <th className="py-3 px-4">Validation</th>
                <th className="py-3 px-4">Approval</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {provenanceList.map((prov) => (
                <tr key={prov.provenance_id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono font-medium text-blue-700 tabular-nums whitespace-nowrap">
                    {prov.verification_id}
                    {prov.is_demo && (
                      <span className="ml-2 text-amber-700 font-semibold">
                        [DEMO DATA]
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-900 font-medium">
                    {prov.document_name}
                  </td>
                  <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                    {prov.output_format} · {prov.audience}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                    {prov.document_fingerprint.slice(0, 14)}...
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                    {prov.output_fingerprint.slice(0, 14)}...
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                    {prov.validation_status} ({prov.validation_score}%)
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {userRole === 'Admin' || userRole === 'Editor' ? (
                      <select
                        value={prov.approval_status}
                        onChange={(e) =>
                          handleUpdateApproval(
                            prov.verification_id,
                            e.target.value as
                              | 'APPROVED'
                              | 'PENDING_REVIEW'
                              | 'REJECTED'
                          )
                        }
                        className="border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-800"
                      >
                        <option value="APPROVED">APPROVED</option>
                        <option value="PENDING_REVIEW">PENDING_REVIEW</option>
                        <option value="REJECTED">REJECTED</option>
                      </select>
                    ) : (
                      <span className="font-mono font-medium text-slate-800">
                        {prov.approval_status}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() =>
                        onSelectVerificationId(prov.verification_id)
                      }
                      className="inline-flex items-center gap-1 border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100"
                    >
                      <span>Public Verify</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Public Verification Mode (/verify/{verification_id} workflow - Section 33)
  return (
    <div className="space-y-6">
      <div className="border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              ContentX Public Verification Portal
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 font-mono">
              Endpoint: /verify/{lookupInput || '{verification_id}'} ·
              Cryptographic SHA-256 Content & Source Authenticity Check
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className=" absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={lookupInput}
                onChange={(e) => setLookupInput(e.target.value)}
                placeholder="Enter vrf_..."
                className="w-64 border border-slate-300 bg-white pl-8 pr-3 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => performVerification(lookupInput)}
              disabled={loading}
              className="bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
            >
              {loading ? 'Verifying...' : 'Verify Certificate'}
            </button>
          </div>
        </div>

        {/* Quick Select Pills for Existing Verification IDs */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
          <span className="text-slate-500">Quick Select Issued IDs:</span>
          {provenanceList.slice(0, 6).map((p) => (
            <button
              key={p.verification_id}
              type="button"
              onClick={() => {
                setLookupInput(p.verification_id);
                setIsTamperTesting(false);
                performVerification(p.verification_id);
              }}
              className={`border px-2.5 py-1 font-mono text-xs transition-colors whitespace-nowrap ${
                lookupInput === p.verification_id
                  ? 'border-blue-600 bg-blue-50 text-blue-800 font-semibold'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
              }`}
            >
              {p.verification_id} ({p.output_format})
            </button>
          ))}
        </div>
      </div>

      {lookupResult && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Official Verification Certificate (Section 33) */}
          <div className="border border-slate-200 bg-white p-6 lg:col-span-7 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <div className="text-xs font-mono text-slate-500">
                  CONTENTX CRYPTOGRAPHIC VERIFICATION CERTIFICATE
                </div>
                <h2 className="mt-0.5 text-lg font-semibold text-slate-900 font-mono">
                  {lookupResult.verification_id}
                </h2>
              </div>

              {lookupResult.status === 'AUTHENTIC' ? (
                <div className="flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-emerald-900">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  <span className="font-mono text-xs font-bold">
                    STATUS: AUTHENTIC
                  </span>
                </div>
              ) : lookupResult.status === 'MODIFIED' ? (
                <div className="flex items-center gap-2 border border-amber-300 bg-amber-50 px-3.5 py-2 text-amber-900">
                  <ShieldAlert className="h-5 w-5 text-amber-600" />
                  <span className="font-mono text-xs font-bold">
                    STATUS: MODIFIED (HASH MISMATCH)
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 border border-red-300 bg-red-50 px-3.5 py-2 text-red-900">
                  <AlertOctagon className="h-5 w-5 text-red-600" />
                  <span className="font-mono text-xs font-bold">
                    STATUS: INVALID
                  </span>
                </div>
              )}
            </div>

            {lookupResult.provenance ? (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="border border-slate-200 bg-slate-50 p-3.5">
                    <div className="text-xs text-slate-500">Document</div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {lookupResult.provenance.document_name}
                      {lookupResult.provenance.is_demo && (
                        <span className="ml-2 font-mono text-xs text-amber-700">
                          [DEMO DATA]
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="border border-slate-200 bg-slate-50 p-3.5">
                    <div className="text-xs text-slate-500">Issuer</div>
                    <div className="mt-1 font-mono text-xs font-semibold text-slate-900">
                      {lookupResult.provenance.issuer}
                    </div>
                  </div>
                  <div className="border border-slate-200 bg-slate-50 p-3.5">
                    <div className="text-xs text-slate-500">Created</div>
                    <div className="mt-1 font-mono text-xs text-slate-900 tabular-nums">
                      {lookupResult.provenance.created_at}
                    </div>
                  </div>
                  <div className="border border-slate-200 bg-slate-50 p-3.5">
                    <div className="text-xs text-slate-500">
                      Format & Target Audience
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-900">
                      {lookupResult.provenance.output_format.toUpperCase()} ·{' '}
                      {lookupResult.provenance.audience}
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5 border border-slate-200 p-4 font-mono text-xs">
                  <div>
                    <span className="text-slate-500">
                      Document Fingerprint (SHA-256):
                    </span>
                    <div className="mt-0.5 break-all text-slate-900 tabular-nums">
                      {lookupResult.provenance.document_fingerprint}
                    </div>
                  </div>
                  <div className="border-t border-slate-100 pt-2">
                    <span className="text-slate-500">
                      Expected Output Fingerprint (SHA-256):
                    </span>
                    <div className="mt-0.5 break-all text-slate-900 tabular-nums">
                      {lookupResult.integrity_check.expected_output_hash}
                    </div>
                  </div>
                  <div className="border-t border-slate-100 pt-2">
                    <span className="text-slate-500">
                      Computed Output Fingerprint (SHA-256):
                    </span>
                    <div
                      className={`mt-0.5 break-all tabular-nums ${
                        lookupResult.integrity_check.output_hash_match
                          ? 'text-emerald-700 font-semibold'
                          : 'text-red-700 font-semibold'
                      }`}
                    >
                      {lookupResult.integrity_check.computed_output_hash}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 border border-slate-200 bg-slate-50 p-4 text-xs font-mono">
                  <div>
                    <div className="text-slate-500">Validation</div>
                    <div className="mt-1 font-bold text-emerald-700">
                      {lookupResult.provenance.validation_status} (
                      {lookupResult.provenance.validation_score}%)
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Fact Traceability</div>
                    <div className="mt-1 font-bold text-emerald-700">
                      {lookupResult.provenance.fact_traceability} (
                      {lookupResult.provenance.fact_ids.length} Facts)
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Approval</div>
                    <div className="mt-1 font-bold text-slate-900">
                      {lookupResult.provenance.approval_status}
                    </div>
                  </div>
                </div>

                {/* Optional Modular Blockchain Anchor (Section 33 & 55) */}
                <div className="border border-slate-200 bg-slate-50/60 p-3.5 text-xs">
                  <div className="flex items-center justify-between font-mono">
                    <span className="font-semibold text-slate-700">
                      Modular Blockchain Anchor Extension
                    </span>
                    <span className="text-slate-500">
                      Status: Provider Not Configured (Optional MVP Module)
                    </span>
                  </div>
                  <p className="mt-1 text-slate-500">
                    Architecture supports L1/L2 state root anchoring (Network,
                    Transaction, Block, Timestamp). Currently operating in local
                    cryptographic SHA-256 verification mode.
                  </p>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-slate-600">
                No provenance record matches verification ID "
                {lookupResult.verification_id}". Status: INVALID.
              </div>
            )}
          </div>

          {/* Interactive Tamper Detection Simulator */}
          <div className="border border-slate-200 bg-white p-6 lg:col-span-5 space-y-4">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Live Tamper & Integrity Verification Sandbox
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Modify any number, claim, or character below and click "Test
                Payload Integrity" to verify that ContentX detects unauthorized
                post-generation edits (`MODIFIED`).
              </p>
            </div>

            <textarea
              rows={13}
              value={tamperPayload}
              onChange={(e) => {
                setTamperPayload(e.target.value);
                setIsTamperTesting(true);
              }}
              className="w-full border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  if (lookupResult.output?.content) {
                    const original = JSON.stringify(
                      lookupResult.output.content
                    );
                    setTamperPayload(
                      JSON.stringify(lookupResult.output.content, null, 2)
                    );
                    setIsTamperTesting(false);
                    performVerification(lookupResult.verification_id, original);
                  }
                }}
                className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Restore Authentic Payload</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  try {
                    const normalized = JSON.stringify(
                      JSON.parse(tamperPayload)
                    );
                    performVerification(
                      lookupResult.verification_id,
                      normalized
                    );
                  } catch {
                    performVerification(
                      lookupResult.verification_id,
                      tamperPayload
                    );
                  }
                }}
                className="inline-flex items-center gap-1.5 bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap"
              >
                <FileCheck2 className="h-3.5 w-3.5" />
                <span>Test Payload Integrity</span>
              </button>
            </div>

            {isTamperTesting && lookupResult.status === 'MODIFIED' && (
              <div className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <strong>Tamper Detected:</strong> The SHA-256 hash of the edited
                payload does not match the signed Output Fingerprint in the
                Provenance Ledger.
              </div>
            )}
            {lookupResult.status === 'AUTHENTIC' && (
              <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>
                  Cryptographic SHA-256 signature matches canonical Fact
                  Registry output 100%.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
