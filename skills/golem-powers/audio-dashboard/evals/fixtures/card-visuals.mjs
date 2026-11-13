import { sourcesSpec } from './sources-drawer.mjs';
export const card = { id: 'visual', title: 'Measured results', sceneIds: ['s1'], rail: [{ label: 'Section', value: 'Results', href: 'https://example.com', newTab: true }],
  tables: [{ caption: 'Checks <now>', columns: ['Check', 'Result', 'Count'], rows: [['<script>bad</script>', { status: 'pass' }, 12]], align: ['left', 'center', 'right'] }],
  charts: [{ type: 'bar', title: 'Throughput', unit: 'jobs', series: [{ name: 'Observed', values: [{ label: 'Before', value: 2 }, { label: 'After', value: 8 }] }] }] };
export const spec = { ...sourcesSpec, decisions: [card], scenes: sourcesSpec.scenes.map(s => ({ ...s, duration: 65.4 })) };
