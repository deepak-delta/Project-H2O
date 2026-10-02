import { CircleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { PageBody, PageHeader } from '../components/layout/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

export default function NotFoundPage() {
  return (
    <>
      <PageHeader title="Not found" back="/" />
      <PageBody>
        <EmptyState
          icon={<CircleAlert className="size-6" />}
          title="This page doesn't exist"
          description="It may have been moved, or the link is wrong."
          action={
            <Link to="/" className="inline-flex h-11 items-center rounded-xl bg-brand-700 px-4 font-semibold text-white">
              Go home
            </Link>
          }
        />
      </PageBody>
    </>
  );
}
