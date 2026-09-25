import { Construction } from 'lucide-react';

interface Props {
  feature: string;
  description: string;
}

export default function ComingSoonTab({ feature, description }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
      <Construction className="h-10 w-10 mb-3 opacity-40" />
      <p className="text-sm font-medium text-foreground mb-1">{feature}</p>
      <p className="text-xs text-center max-w-md">{description}</p>
    </div>
  );
}
