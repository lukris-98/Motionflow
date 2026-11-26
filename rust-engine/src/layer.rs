/// High-performance Rust layer management & timeline math kernels (`no_std`-friendly).
/// Handles clip snapping, trim bounds, reverse/forward split offsets, and dynamic ruler LOD tiers.

pub fn snap_frame(
    candidate_start: i32,
    clip_len: i32,
    playhead_frame: i32,
    edges: &[i32],
    threshold: i32,
) -> i32 {
    if (candidate_start - 0).abs() <= threshold {
        return 0;
    }
    if (candidate_start + clip_len - 0).abs() <= threshold {
        return 0;
    }
    if (candidate_start - playhead_frame).abs() <= threshold {
        return playhead_frame.max(0);
    }
    if (candidate_start + clip_len - playhead_frame).abs() <= threshold {
        return (playhead_frame - clip_len).max(0);
    }

    for &edge in edges {
        if (candidate_start - edge).abs() <= threshold {
            return edge.max(0);
        }
        if (candidate_start + clip_len - edge).abs() <= threshold {
            return (edge - clip_len).max(0);
        }
    }

    candidate_start.max(0)
}

pub fn trim_bounds(
    is_right: bool,
    orig_start: i32,
    orig_end: i32,
    orig_offset: i32,
    new_frame: i32,
    speed: f32,
    snap_enabled: bool,
    playhead_frame: i32,
) -> (i32, i32, i32) {
    let min_len = 5;
    let mut f = new_frame.max(0);
    if snap_enabled && (f - playhead_frame).abs() <= 4 {
        f = playhead_frame.max(0);
    }

    if !is_right {
        let max_start = orig_end - min_len;
        let clamped_start = f.min(max_start).max(0);
        let diff = clamped_start - orig_start;
        let delta_media = ((diff as f32) * speed.max(0.05)).round() as i32;
        let next_offset = (orig_offset + delta_media).max(0);
        (clamped_start, orig_end, next_offset)
    } else {
        let clamped_end = f.max(orig_start + min_len);
        (orig_start, clamped_end, orig_offset.max(0))
    }
}

pub fn split_media_offsets(
    orig_start: i32,
    orig_end: i32,
    split_frame: i32,
    orig_offset: i32,
    speed: f32,
    reversed: bool,
) -> (i32, i32) {
    let spd = speed.max(0.05);
    if reversed {
        let right_frames = (orig_end - split_frame).max(0);
        let left_offset = (orig_offset + ((right_frames as f32) * spd).round() as i32).max(0);
        (left_offset, orig_offset.max(0))
    } else {
        let delta_frames = (split_frame - orig_start).max(0);
        let right_offset = (orig_offset + ((delta_frames as f32) * spd).round() as i32).max(0);
        (orig_offset.max(0), right_offset)
    }
}

/// Returns dynamic ruler LOD tier (0..7) for a given `px_per_frame` and `fps` (default 30 frames/sec).
pub fn ruler_lod_tier(px_per_frame: f32, fps: f32) -> u32 {
    let px_per_sec = px_per_frame * fps.max(1.0);
    if px_per_sec < 10.0 {
        0 // 30s major, 5s minor (minutes view)
    } else if px_per_sec < 24.0 {
        1 // 10s major, 2s minor
    } else if px_per_sec < 50.0 {
        2 // 5s major, 1s minor (default overview: 0s, 5s, 10s...)
    } else if px_per_sec < 120.0 {
        3 // 1s major, 15f minor (1s, 2s, 3s... 10s)
    } else if px_per_sec < 260.0 {
        4 // 1s major, 15f label, 5f minor
    } else if px_per_sec < 520.0 {
        5 // 1s major, 10f label, 5f minor
    } else if px_per_sec < 900.0 {
        6 // 1s major, 5f label, 1f minor
    } else {
        7 // 1s major, 1f ticks & labels (30 frames/sec)
    }
}
