create table if not exists public.transaction_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  owner_email text not null,
  viewer_id uuid not null references auth.users (id) on delete cascade,
  viewer_email text not null,
  created_at timestamptz not null default now(),
  constraint transaction_shares_owner_viewer_unique unique (owner_id, viewer_id),
  constraint transaction_shares_not_self check (owner_id <> viewer_id)
);

create index if not exists transaction_shares_viewer_owner_idx
  on public.transaction_shares (viewer_id, owner_id);

alter table public.transaction_shares enable row level security;

revoke all on table public.transaction_shares from anon, authenticated;
grant select on table public.transaction_shares to authenticated;

drop policy if exists "Users can view their ledger shares"
  on public.transaction_shares;
create policy "Users can view their ledger shares"
  on public.transaction_shares for select to authenticated
  using (
    (select auth.uid()) = owner_id
    or (select auth.uid()) = viewer_id
  );

drop policy if exists "Users can read their own transactions"
  on public.transactions;
drop policy if exists "Owners and viewers can read transactions"
  on public.transactions;
create policy "Owners and viewers can read transactions"
  on public.transactions for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.transaction_shares
      where transaction_shares.owner_id = transactions.user_id
        and transaction_shares.viewer_id = (select auth.uid())
    )
  );
