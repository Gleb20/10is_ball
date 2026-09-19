# Safe replay of accepted WO1 R2 probes

The four retained probe scripts in `../stage3-wo1-r2/` write their outputs back
into that accepted evidence directory. Run them only in a disposable copy of the
accepted checkout and evidence. Before each replay, inspect every output path
in the selected script and direct all generated files to the disposable copy.
Do not run the scripts in this working tree or replace the accepted R1/R2 files.
The WO2 checks and raw logs belong in this separate `stage3-wo2` directory.

This note records the replay boundary; it does not claim a new browser run.
