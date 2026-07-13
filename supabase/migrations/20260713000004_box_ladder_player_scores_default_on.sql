-- Box/ladder player self-scoring is on by default (player-run), but organizers get an
-- off-switch via the existing allow_player_scores toggle. Rather than special-case the
-- format in code (which left no way to turn it off), we backfill existing box/ladder
-- leagues to allow_player_scores = true and let the toggle govern uniformly. New
-- box/ladder leagues default the toggle on in the create form.
update public.leagues set allow_player_scores = true
where format_kind in ('box', 'ladder') and allow_player_scores is not true;
