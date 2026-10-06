create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null default current_date,
  type text not null check (type in ('credit', 'debit')),
  amount numeric(12, 2) not null,
  tag text not null check (char_length(trim(tag)) > 0),
  created_at timestamptz not null default now()
);

alter table public.transactions
  drop constraint if exists transactions_amount_check;

alter table public.transactions
  drop constraint if exists transactions_amount_sign_check;

alter table public.transactions
  add constraint transactions_amount_sign_check
  check (
    (type = 'credit' and amount <> 0)
    or (type = 'debit' and amount > 0)
  );

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, date desc, created_at desc);

grant select, insert, update, delete on table public.transactions to authenticated;

alter table public.transactions enable row level security;

drop policy if exists "Users can read their own transactions" on public.transactions;
create policy "Users can read their own transactions"
  on public.transactions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own transactions" on public.transactions;
create policy "Users can insert their own transactions"
  on public.transactions for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own transactions" on public.transactions;
create policy "Users can update their own transactions"
  on public.transactions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own transactions" on public.transactions;
create policy "Users can delete their own transactions"
  on public.transactions for delete to authenticated
  using ((select auth.uid()) = user_id);
