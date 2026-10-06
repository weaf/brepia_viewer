import { createFileRoute } from '@tanstack/react-router';
import {
  isUnauthorizedError,
  json,
  preflight,
  requireUser,
} from '@/server/api';
import { opencodeModels } from '@/server/opencode';
import { configuredCodexModels } from '@/server/cliAgents';

export const Route = createFileRoute('/api/opencode/models')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request }) => {
        try {
          await requireUser(request);
          const models = await opencodeModels();
          return json([
            ...models.map((m) => ({
              id: `agent/opencode/${m.cliId}`,
              name: `OpenCode · ${m.name}`,
              description: `OpenCode agent via ${m.providerID}`,
              provider: 'OpenCode Agent',
              supportsTools: true,
              supportsThinking: false,
              supportsVision: false,
            })),
            ...configuredCodexModels(),
          ]);
        } catch (err) {
          return json(
            {
              error: isUnauthorizedError(err)
                ? 'Unauthorized'
                : 'opencode_unavailable',
            },
            isUnauthorizedError(err) ? 401 : 502,
          );
        }
      },
    },
  },
});
