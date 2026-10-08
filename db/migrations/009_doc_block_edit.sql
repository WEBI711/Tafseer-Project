-- Audit trail for doc_block edits made through the app's editor endpoint.
-- One row per saved edit: who (the designated editor), when, and the exact
-- before/after text, so the author's words can always be traced or restored.
CREATE TABLE IF NOT EXISTS doc_block_edit (
    id          SERIAL PRIMARY KEY,
    block_id    INT,             -- doc_block.id at edit time (no FK: doc_block
                                 -- is dropped and rebuilt by migrations, the
                                 -- audit must survive a re-ingest)
    source_file TEXT NOT NULL,
    ord         INT NOT NULL,
    editor      TEXT NOT NULL,
    before_text TEXT NOT NULL,
    after_text  TEXT NOT NULL,
    edited_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS doc_block_edit_file_idx
    ON doc_block_edit (source_file, ord, edited_at);
