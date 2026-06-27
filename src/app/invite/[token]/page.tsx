import { redirect } from 'next/navigation';

export default function InvitePage({ params }: { params: { token: string } }) {
  redirect(`/join/${params.token}`);
}
