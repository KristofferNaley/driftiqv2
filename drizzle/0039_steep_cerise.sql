CREATE TABLE "job_runs" (
	"id" varchar PRIMARY KEY NOT NULL,
	"job" varchar NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"ok" boolean NOT NULL,
	"detail" text
);
