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
