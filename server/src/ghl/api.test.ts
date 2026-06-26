import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the OAuth token getter (else it reaches the token store / DB) and axios.
vi.mock('./oauth.js', () => ({
  getValidAccessToken: vi.fn(async () => 'test-token'),
}));
vi.mock('axios', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
}));

import axios from 'axios';
import { updateAgentPrompt, PromptConflictError } from './api.js';

const mockGet = axios.get as unknown as ReturnType<typeof vi.fn>;
const mockPatch = axios.patch as unknown as ReturnType<typeof vi.fn>;

/** Build a /voice-ai/agents GET response with one agent. */
const agentsResponse = (agentPrompt: string, actions: number) => ({
  data: { agents: [{ id: 'agent-1', agentPrompt, actions: new Array(actions).fill({}) }] },
});

describe('updateAgentPrompt', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
    mockPatch.mockResolvedValue({ data: {} });
  });

  it('PATCHes only agentPrompt and verifies the write took with actions intact', async () => {
    mockGet
      .mockResolvedValueOnce(agentsResponse('OLD PROMPT', 9)) // before
      .mockResolvedValueOnce(agentsResponse('NEW PROMPT', 9)); // after

    const result = await updateAgentPrompt('agent-1', 'loc-1', 'NEW PROMPT');

    expect(result).toEqual({
      ok: true,
      beforeActions: 9,
      afterActions: 9,
      actionsPreserved: true,
      updatedPrompt: 'NEW PROMPT',
    });
    // Body carries ONLY agentPrompt — never `actions`.
    expect(mockPatch).toHaveBeenCalledTimes(1);
    const body = mockPatch.mock.calls[0]![1];
    expect(body).toEqual({ agentPrompt: 'NEW PROMPT' });
    expect(body).not.toHaveProperty('actions');
  });

  it('throws PromptConflictError WITHOUT writing when the live prompt drifted from the baseline', async () => {
    mockGet.mockResolvedValueOnce(agentsResponse('LIVE PROMPT (changed)', 9));

    await expect(
      updateAgentPrompt('agent-1', 'loc-1', 'NEW PROMPT', 'STALE BASELINE'),
    ).rejects.toBeInstanceOf(PromptConflictError);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('passes the baseline check when the live prompt still matches', async () => {
    mockGet
      .mockResolvedValueOnce(agentsResponse('BASELINE', 9))
      .mockResolvedValueOnce(agentsResponse('NEW PROMPT', 9));

    const result = await updateAgentPrompt('agent-1', 'loc-1', 'NEW PROMPT', 'BASELINE');
    expect(result.ok).toBe(true);
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });

  it('flags actionsPreserved=false when the action count drops after the PATCH', async () => {
    mockGet
      .mockResolvedValueOnce(agentsResponse('OLD', 9)) // before: 9 actions
      .mockResolvedValueOnce(agentsResponse('NEW PROMPT', 0)); // after: clobbered

    const result = await updateAgentPrompt('agent-1', 'loc-1', 'NEW PROMPT');
    expect(result.actionsPreserved).toBe(false);
    expect(result.beforeActions).toBe(9);
    expect(result.afterActions).toBe(0);
  });

  it('reports ok=false when the prompt did not change on read-back', async () => {
    mockGet
      .mockResolvedValueOnce(agentsResponse('OLD', 9))
      .mockResolvedValueOnce(agentsResponse('STILL OLD', 9)); // write didn't take

    const result = await updateAgentPrompt('agent-1', 'loc-1', 'NEW PROMPT');
    expect(result.ok).toBe(false);
    expect(result.actionsPreserved).toBe(true);
  });

  it('throws when the agent is not found in the location', async () => {
    mockGet.mockResolvedValueOnce({ data: { agents: [] } });
    await expect(updateAgentPrompt('missing', 'loc-1', 'NEW')).rejects.toThrow(/not found/);
    expect(mockPatch).not.toHaveBeenCalled();
  });
});
