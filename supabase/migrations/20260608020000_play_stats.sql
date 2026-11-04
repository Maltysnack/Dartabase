-- Play: anonymous daily global stats (point #2, retention).
--
-- Stores per-puzzle aggregate counters only: how many people played, how many
-- solved, and the distribution of winning guess counts. No personal data, no
-- identity, no per-user rows. The result screen shows "X% solved today" so a
-- solo player gets the Wordle/Connections "how did I do vs everyone" hook
-- without any account.
--
-- Writes go only through record_play (security definer), so anon can increment
-- but cannot tamper with arbitrary rows. Reads are public (aggregates only).

create table if not exists play_stats (
  puzzle_number int primary key,
  plays int not null default 0,
  wins int not null default 0,
  dist jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table play_stats enable row level security;

drop policy if exists "play_stats_public_read" on play_stats;
create policy "play_stats_public_read" on play_stats for select using (true);

create or replace function record_play(p_puzzle int, p_won boolean, p_guesses int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bucket text;
begin
  if p_puzzle is null or p_puzzle < 1 then return; end if;
  bucket := case when p_won then least(greatest(coalesce(p_guesses, 1), 1), 5)::text else 'fail' end;
  insert into play_stats (puzzle_number, plays, wins, dist, updated_at)
    values (p_puzzle, 1, case when p_won then 1 else 0 end, jsonb_build_object(bucket, 1), now())
  on conflict (puzzle_number) do update set
    plays = play_stats.plays + 1,
    wins = play_stats.wins + (case when p_won then 1 else 0 end),
    dist = jsonb_set(play_stats.dist, array[bucket],
            to_jsonb(coalesce((play_stats.dist->>bucket)::int, 0) + 1), true),
    updated_at = now();
end;
$$;

grant execute on function record_play(int, boolean, int) to anon, authenticated;
