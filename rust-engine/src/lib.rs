pub mod audio;
pub mod keyframe;
pub mod layer;
pub mod mat4;

use core::slice;

/// Evaluates cubic bezier easing P1(x1, y1), P2(x2, y2) at normalized time t in [0, 1].
#[no_mangle]
pub extern "C" fn mf_eval_cubic_bezier(t: f32, x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
    keyframe::eval_cubic_bezier(t, x1, y1, x2, y2)
}

/// Evaluates an interpolated value across keyframes packed as [frame, value, easing_id, x1, y1, x2, y2] (7 floats per keyframe).
#[no_mangle]
pub extern "C" fn mf_eval_keyframe_track(
    ptr: *const f32,
    kf_count: usize,
    frame: f32,
    fallback: f32,
) -> f32 {
    if ptr.is_null() || kf_count == 0 {
        return fallback;
    }
    let data = unsafe { slice::from_raw_parts(ptr, kf_count * 7) };
    keyframe::eval_packed_track(data, kf_count, frame, fallback)
}

/// Multiplies two 4x4 column-major matrices (a * b -> out).
#[no_mangle]
pub extern "C" fn mf_mat4_multiply(a_ptr: *const f32, b_ptr: *const f32, out_ptr: *mut f32) {
    if a_ptr.is_null() || b_ptr.is_null() || out_ptr.is_null() {
        return;
    }
    let a = unsafe { slice::from_raw_parts(a_ptr, 16) };
    let b = unsafe { slice::from_raw_parts(b_ptr, 16) };
    let out = unsafe { slice::from_raw_parts_mut(out_ptr, 16) };
    mat4::multiply_into(a, b, out);
}

/// Mixes floating-point stereo audio samples into clamped Int16 stereo PCM in-place.
#[no_mangle]
pub extern "C" fn mf_mix_f32_to_i16(
    src_l: *const f32,
    src_r: *const f32,
    dst_i16: *mut i16,
    frames: usize,
    gain: f32,
) {
    if src_l.is_null() || src_r.is_null() || dst_i16.is_null() || frames == 0 {
        return;
    }
    let l = unsafe { slice::from_raw_parts(src_l, frames) };
    let r = unsafe { slice::from_raw_parts(src_r, frames) };
    let dst = unsafe { slice::from_raw_parts_mut(dst_i16, frames * 2) };
    audio::mix_stereo_to_i16(l, r, dst, gain);
}

#[no_mangle]
pub extern "C" fn mf_layer_snap_frame(
    candidate_start: i32,
    clip_len: i32,
    playhead_frame: i32,
    edges_ptr: *const i32,
    edge_count: usize,
    threshold: i32,
) -> i32 {
    let edges = if edges_ptr.is_null() || edge_count == 0 {
        &[]
    } else {
        unsafe { slice::from_raw_parts(edges_ptr, edge_count) }
    };
    layer::snap_frame(candidate_start, clip_len, playhead_frame, edges, threshold)
}

#[no_mangle]
pub extern "C" fn mf_layer_trim_bounds(
    is_right: i32,
    orig_start: i32,
    orig_end: i32,
    orig_offset: i32,
    new_frame: i32,
    speed: f32,
    snap_enabled: i32,
    playhead_frame: i32,
    out_ptr: *mut i32,
) {
    if out_ptr.is_null() {
        return;
    }
    let (s, e, off) = layer::trim_bounds(
        is_right != 0,
        orig_start,
        orig_end,
        orig_offset,
        new_frame,
        speed,
        snap_enabled != 0,
        playhead_frame,
    );
    let out = unsafe { slice::from_raw_parts_mut(out_ptr, 3) };
    out[0] = s;
    out[1] = e;
    out[2] = off;
}

#[no_mangle]
pub extern "C" fn mf_layer_split_offsets(
    orig_start: i32,
    orig_end: i32,
    split_frame: i32,
    orig_offset: i32,
    speed: f32,
    reversed: i32,
    out_ptr: *mut i32,
) {
    if out_ptr.is_null() {
        return;
    }
    let (left_off, right_off) = layer::split_media_offsets(
        orig_start,
        orig_end,
        split_frame,
        orig_offset,
        speed,
        reversed != 0,
    );
    let out = unsafe { slice::from_raw_parts_mut(out_ptr, 2) };
    out[0] = left_off;
    out[1] = right_off;
}

#[no_mangle]
pub extern "C" fn mf_ruler_lod_tier(px_per_frame: f32, fps: f32) -> u32 {
    layer::ruler_lod_tier(px_per_frame, fps)
}

#[cfg(feature = "android-jni")]
pub mod android_jni {
    use jni::objects::JClass;
    use jni::sys::jfloat;
    use jni::JNIEnv;

    #[no_mangle]
    pub extern "system" fn Java_com_example_RustBridge_evalCubicBezier(
        _env: JNIEnv,
        _class: JClass,
        t: jfloat,
        x1: jfloat,
        y1: jfloat,
        x2: jfloat,
        y2: jfloat,
    ) -> jfloat {
        crate::keyframe::eval_cubic_bezier(t, x1, y1, x2, y2)
    }
}
