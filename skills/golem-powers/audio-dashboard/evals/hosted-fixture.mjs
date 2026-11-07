import { sha256 } from "../src/hosted-delivery.mjs";

export function hostedEvidence(evidence) {
  const sourceHtml = '<!-- prepared input -->' + evidence.html, sourceHtmlSha256 = sha256(sourceHtml), at = '2026-11-08T00:00:00.000Z';
  return { ...evidence, sourceHtml, dashboardId: 'example', approvedDeliveryOrigins: ['https://example.com'],
    handoff: { schema: 'audio-dashboard.publish-handoff.v2', dashboardId: 'example', builtHtmlSha256: sha256(evidence.html), sourceHtmlSha256, design: { admission: 'COMPARED' } },
    delivery: { schema: 'audio-dashboard.delivery.v2', host: 'lakebed', url: 'https://example.com/?d=example',
      dashboardId: 'example', sourceHtmlSha256, servedShellSha256: 'b'.repeat(64), artifactSha256: 'a'.repeat(64),
      staging: { mode: 'unlisted-candidate', servedShellSha256: 'b'.repeat(64) },
      admission: { design: 'COMPARED', answerIdentity: 'PASS', providerReady: true, gateVersion: 'fixture-v2' },
      accountProof: { probe: 'dedicated-key', signedIn: true, independentClient: true, serverAck: true, mutationDelta: 0, existingRowsPreserved: 0, method: 'note-roundtrip', markerSaved: true,
        restoredAfterLocalKeysCleared: true, cleanedUp: true, disposableRecord: true, at }, publishedAt: at } };
}
