const ENDPOINT = '/api/ai/speech-to-text';

export async function speechToText(
  file: Blob | File,
  accessToken: string,
  workspaceId: string,
  parameters: object = {}
) {
  const formData = new FormData();
  formData.append('provider', 'OPEN_AI');
  formData.append('model', 'gpt-4o-transcribe');
  formData.append('workspaceId', workspaceId);
  formData.append('parameters', JSON.stringify(parameters));
  formData.append('file', file);

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    console.error('API Route Error:', {
      error: data.error,
      details: data.details,
    });
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}
