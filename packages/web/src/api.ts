import type { JobType, JobView } from '@yard/shared';

export interface SubmitRequest {
  type: JobType;
  params: Record<string, number>;
  count: number;
  timeoutMs: number;
}

export async function submitJobs(input: SubmitRequest): Promise<JobView[]> {
  if (input.count <= 1) {
    const body = await request<{ job: JobView }>('/api/jobs', {
      type: input.type,
      params: input.params,
      timeoutMs: input.timeoutMs,
    });
    return [body.job];
  }
  const body = await request<{ jobs: JobView[] }>('/api/jobs/bulk', input);
  return body.jobs;
}

export async function cancelJob(id: string): Promise<JobView> {
  const body = await request<{ job: JobView }>(`/api/jobs/${id}/cancel`, {});
  return body.job;
}

export async function retryJob(id: string): Promise<JobView> {
  const body = await request<{ job: JobView }>(`/api/jobs/${id}/retry`, {});
  return body.job;
}

async function request<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string });
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}
