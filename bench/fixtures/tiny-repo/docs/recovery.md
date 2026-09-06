# Recovery notes

Current source remains authoritative. A cached summary is derived state and can be rebuilt.

When a source digest changes during capture, report `SOURCE_MOVED` and obtain a new snapshot instead of returning different bytes under the old reference.

A derived cache may be discarded and rebuilt from source. It must not become hidden canonical truth.
