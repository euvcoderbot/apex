// Captured observations are NOT fresh cache entries. These explicit policies
// permit retaining an audited older calculation with its original provenance.
// An unrecognized future code revision gets no compatibility allowance.
import policies from './snapshot-policy.json' with {type:'json'};
export const SNAPSHOT_POLICIES = policies;
export function snapshotCompatible(family, stored, current) {
  return Boolean(stored && (stored === current || SNAPSHOT_POLICIES[family]?.[current]?.includes(stored)));
}
export function snapshotPolicy(revisions) {
  return Object.fromEntries(Object.entries(revisions).map(([family,current])=>[family,SNAPSHOT_POLICIES[family]?.[current]||[]]));
}
export function tagCaptureRevisions(index) {
  const revisions=Object.fromEntries(['sourceRevision','backendRevision','measurementRevision'].map(k=>[k,index[k]]));
  return Object.fromEntries(Object.entries(index.entries||{}).map(([key,value])=>[key,{...revisions,...value}]));
}
