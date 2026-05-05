# Project Ascension: Development Instructions

## Architecture Overview
- **Backend (Kernel):** Rust (Axum) for performance and safety.
- **Frontend (Unified Interface):** Tauri (Rust) + React (TypeScript) + TailwindCSS.
- **CLI:** Unified Rust binary for execution and monitoring.

## Styling (Night Pink by SamRC)
- **Background:** `#1a1a2e`
- **Primary Accent:** `#ff79c6`
- **Secondary Accent:** `#bd93f9`
- **Strings/Success:** `#8be9fd`
- **Warning/Alert:** `#d600ff`

## Workflow & Conventions
- **Version Control:** Mandatory Git usage. Initialize features in branches.
- **Verification:** Empirically reproduce bugs and verify all changes with tests.
- **Security:** Judicial Audit (Supreme Mode) logic should be carried over.
- **Encoding:** Strictly UTF-8 to avoid mojibake.
