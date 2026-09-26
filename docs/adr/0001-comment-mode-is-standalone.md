# Comment mode is standalone, not part of portfolio

Comment mode is built as a general tool that anyone can add to HTML pages agents make, and lives in its own public repo under Skinnys-Bootleg-Codeshop. The portfolio /admin panel is its first host. It knows nothing about portfolio's decision comments or review batches, and it does not share their records or store; those stay as they are. We chose this so the tool stays reusable and the portfolio's decision-specific model doesn't leak into it.
