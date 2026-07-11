import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center bg-background text-foreground font-mono">
      <div className="flex flex-col items-center space-y-4 text-center">
        <h1 className="text-4xl font-bold text-primary">404</h1>
        <p className="text-muted-foreground max-w-sm">
          Target not found. The resource you requested does not exist on this server.
        </p>
        <Link href="/" className="mt-4 text-sm text-primary hover:underline">
          Return to Workspace
        </Link>
      </div>
    </div>
  );
}
