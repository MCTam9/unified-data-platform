-- ============================================================================
-- UNIFIED DATA PLATFORM — FINANCE-GRADE ENFORCEMENT (section 07d)
-- Period locking and the audit trail: the things that make an FD trust a number.
-- ============================================================================

-- ----------------------------------------------------------- period locking
-- After close, the number is FROZEN. Corrections to a locked period go in as
-- dated adjustments (core.period_adjustment) in the CURRENT period, never as
-- an edit to history — the same way the accounting package works.

create or replace function core.reject_locked_period()
returns trigger
language plpgsql
as $$
declare
    v_date date;
begin
    -- Which date determines the row's accounting period varies by table.
    if tg_table_name = 'payment' then
        v_date := coalesce(new.received_on, old.received_on);
    else
        v_date := coalesce(new.period_start, old.period_start);
    end if;

    if exists (
        select 1 from core.accounting_period ap
        where ap.status in ('closed','locked')
          and v_date >= ap.period_start
          and v_date <= ap.period_end
    ) then
        raise exception
            'period containing % is closed: book a core.period_adjustment in the current period instead',
            v_date
            using errcode = 'raise_exception';
    end if;
    return coalesce(new, old);
end;
$$;

drop trigger if exists invoice_period_lock on core.invoice;
create trigger invoice_period_lock
    before insert or update or delete on core.invoice
    for each row execute function core.reject_locked_period();

drop trigger if exists payment_period_lock on core.payment;
create trigger payment_period_lock
    before insert or update or delete on core.payment
    for each row execute function core.reject_locked_period();

drop trigger if exists expense_period_lock on core.expense;
create trigger expense_period_lock
    before insert or update or delete on core.expense
    for each row execute function core.reject_locked_period();

-- -------------------------------------------------------------- audit trail
-- One generic append-only log written by triggers beats per-table history
-- columns nobody maintains. The acting user comes from a session variable the
-- API sets; falls back to the connected role.

create or replace function core.write_audit_log()
returns trigger
language plpgsql
as $$
declare
    v_row_id uuid;
begin
    -- First trigger argument names the PK column of the audited table.
    if tg_op = 'DELETE' then
        v_row_id := (to_jsonb(old) ->> tg_argv[0])::uuid;
        insert into core.audit_log (table_name, row_id, action, changed_by, old_values, new_values)
        values (tg_table_name, v_row_id, 'delete',
                coalesce(current_setting('app.user_email', true), current_user),
                to_jsonb(old), null);
        return old;
    elsif tg_op = 'UPDATE' then
        v_row_id := (to_jsonb(new) ->> tg_argv[0])::uuid;
        insert into core.audit_log (table_name, row_id, action, changed_by, old_values, new_values)
        values (tg_table_name, v_row_id, 'update',
                coalesce(current_setting('app.user_email', true), current_user),
                to_jsonb(old), to_jsonb(new));
        return new;
    else
        v_row_id := (to_jsonb(new) ->> tg_argv[0])::uuid;
        insert into core.audit_log (table_name, row_id, action, changed_by, old_values, new_values)
        values (tg_table_name, v_row_id, 'insert',
                coalesce(current_setting('app.user_email', true), current_user),
                null, to_jsonb(new));
        return new;
    end if;
end;
$$;

-- Audit the tables where a silent change destroys trust in a reported number.
drop trigger if exists invoice_audit on core.invoice;
create trigger invoice_audit
    after insert or update or delete on core.invoice
    for each row execute function core.write_audit_log('invoice_id');

drop trigger if exists payment_audit on core.payment;
create trigger payment_audit
    after insert or update or delete on core.payment
    for each row execute function core.write_audit_log('payment_id');

drop trigger if exists expense_audit on core.expense;
create trigger expense_audit
    after insert or update or delete on core.expense
    for each row execute function core.write_audit_log('expense_id');

drop trigger if exists licence_audit on core.licence_agreement;
create trigger licence_audit
    after insert or update or delete on core.licence_agreement
    for each row execute function core.write_audit_log('licence_id');

drop trigger if exists budget_audit on core.budget_line;
create trigger budget_audit
    after insert or update or delete on core.budget_line
    for each row execute function core.write_audit_log('budget_id');
