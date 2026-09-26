begin;

alter table public.prelim_scores
  drop constraint if exists prelim_scores_score_check,
  add constraint prelim_scores_score_check check (score between 1 and 10);

alter table public.rankings
  drop constraint if exists rankings_average_score_check,
  alter column average_score type numeric(4, 2),
  add constraint rankings_average_score_check check (average_score is null or average_score between 1 and 10);

commit;
