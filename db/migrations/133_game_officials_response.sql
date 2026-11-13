-- Officials answer their games (SPEC.md section 14, step 4c-5): on their dashboard each assigned game has ✓ (good for it)
-- and ✗ (can't make it). Cleared when the game's time or place changes; the Assigner sees it on the board.
alter table game_officials add column response text check (response in ('yes', 'no'));
alter table game_officials add column responded_at timestamptz;
