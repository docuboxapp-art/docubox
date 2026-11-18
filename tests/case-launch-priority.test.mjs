import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const actor = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222';
let actions = [],
  failPriority = false;
globalThis.__priorityService = {
  async rpc(name, args) {
    assert.equal(name, 'case_launch_configured');
    actions.push(['launch', args.p_settings]);
    return { data: { id }, error: null };
  },
  from(table) {
    assert.equal(table, 'case_files');
    let values,
      conditions = [];
    return {
      update(v) {
        values = v;
        return this;
      },
      eq(k, v) {
        conditions.push([k, v]);
        return this;
      },
      select() {
        return this;
      },
      async single() {
        actions.push(['priority', values, conditions]);
        return failPriority
          ? { error: { code: 'unavailable' }, data: null }
          : { data: { id }, error: null };
      },
    };
  },
};
globalThis.__priorityDispatch = async () => {
  actions.push(['dispatch']);
  return { total: 1, sent: 1 };
};
const output = await build({
  entryPoints: ['src/app/api/expedientes/iniciar/route.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'priority-mocks',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^next\/server$|supabase\/server$|runtime\.server$|invitations\.server$|server-rate-limit$|launch-access\.server$/,
          },
          (args) => ({ path: args.path, namespace: 'mock' })
        );
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          loader: 'js',
          contents:
            path === 'next/server'
              ? 'export class NextResponse { static json(body,init){return Response.json(body,init);} }'
              : path.endsWith('supabase/server')
                ? 'export const createServiceClient=()=>globalThis.__priorityService;'
                : path.endsWith('runtime.server')
                  ? `export const caseIdentity=async()=>({id:'${actor}'});export const record=v=>v&&typeof v==='object'?v:{};export const textValue=v=>typeof v==='string'?v:'';export const isUuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);export const runtimeHeaders={};export class CaseRuntimeError extends Error {constructor(code,message,status){super(message);this.status=status;}}export const runtimeFailure=e=>({status:e.status||500,body:{error:e.message}});`
                  : path.endsWith('invitations.server')
                    ? 'export const caseInvitationConfig=()=>({secret:"test-only"});export const caseInvitationOrigin=()=>"http://localhost";export const configureCaseInvitationDispatch=async()=>{};export const sendCaseInvitations=(...args)=>globalThis.__priorityDispatch(...args);'
                    : path.endsWith('server-rate-limit')
                      ? 'export const consumeServerRateLimit=async()=>true;'
                      : 'export const caseLaunchCredential=()=>({});export const casePublicLaunchAccess=async()=>null;',
        }));
      },
    },
  ],
});
const { POST } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
);
async function launch(urgent) {
  actions = [];
  const response = await POST({
    text: async () =>
      JSON.stringify({
        templateId: id,
        operationKey: id,
        title: 'Expediente sintético',
        subjectName: 'Participante sintético',
        subjectEmail: 'synthetic@example.test',
        participants: [],
        assignments: {},
        settings: {
          accessMode: 'private',
          signatureType: 'autografa_digital',
          requireLiveness: false,
          expirationHours: 168,
          scheduledAt: null,
          timezone: 'America/Mazatlan',
          urgent,
        },
      }),
  });
  return response;
}
test('launch saves urgent priority on the created case before sending invitations', async () => {
  failPriority = false;
  assert.equal((await launch(true)).status, 200);
  assert.deepEqual(
    actions.map((a) => a[0]),
    ['launch', 'priority', 'dispatch']
  );
  assert.equal(actions[0][1].urgent, true);
  assert.deepEqual(actions[1].slice(1), [
    { priority: 'urgent' },
    [
      ['id', id],
      ['created_by', actor],
    ],
  ]);
  assert.equal((await launch(false)).status, 200);
  assert.deepEqual(actions[1][1], { priority: 'normal' });
});
test('invalid urgency and failed priority persistence cannot dispatch invitations', async () => {
  assert.equal((await launch('true')).status, 422);
  assert.deepEqual(actions, []);
  failPriority = true;
  assert.equal((await launch(true)).status, 503);
  assert.deepEqual(
    actions.map((a) => a[0]),
    ['launch', 'priority']
  );
  failPriority = false;
});
