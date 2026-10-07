#!/usr/bin/env bash
echo "========================================================"
echo "  Starting AMAI PC Bridge (Node.js)"
echo "========================================================"
cd "$(dirname "$0")/pc" || exit 1
npm start

