-- Keep the half-hour cadence while avoiding five task workers starting together
-- with form-launch-dispatch and hourly maintenance at minute 0/30.
do $$
declare
  task_job record;
  task_job_id bigint;
begin
  for task_job in
    select * from (values
      ('docubox-task-reconcile', '1,31 * * * *'),
      ('docubox-task-extended', '2,32 * * * *'),
      ('docubox-task-form-signatures', '3,33 * * * *'),
      ('docubox-task-custom-pipeline', '4,34 * * * *'),
      ('docubox-task-risk-signals', '5,35 * * * *')
    ) as jobs(name, schedule)
  loop
    select jobid into task_job_id
    from cron.job
    where jobname = task_job.name;

    if task_job_id is not null then
      perform cron.alter_job(job_id := task_job_id, schedule := task_job.schedule);
    end if;
  end loop;
end;
$$;
