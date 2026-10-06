import { Avatar } from '@/components/ui/avatar';
import { ActivityIndicator, BrepiaMark } from '@/components/brand';

export function AssistantLoading() {
  return (
    <div className="flex w-full p-1">
      <div className="mr-2 mt-1 hidden sm:block">
        <Avatar className="flex h-9 w-9 items-center justify-center border border-adam-neutral-700 bg-adam-neutral-950 p-1.5">
          <BrepiaMark title="Brepia" className="h-full w-full" />
        </Avatar>
      </div>
      <div className="flex max-w-[80%] flex-col items-center justify-center gap-2 rounded-lg bg-adam-neutral-800 p-3">
        <ActivityIndicator label="Brepia is working" size="sm" />
      </div>
    </div>
  );
}
