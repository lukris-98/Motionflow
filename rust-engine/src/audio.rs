pub fn mix_stereo_to_i16(left: &[f32], right: &[f32], dst_interleaved: &mut [i16], gain: f32) {
    let n = left.len().min(right.len()).min(dst_interleaved.len() / 2);
    for i in 0..n {
        let l = (left[i] * gain).clamp(-1.0, 1.0);
        let r = (right[i] * gain).clamp(-1.0, 1.0);
        dst_interleaved[i * 2] = if l < 0.0 {
            (l * 32768.0) as i16
        } else {
            (l * 32767.0) as i16
        };
        dst_interleaved[i * 2 + 1] = if r < 0.0 {
            (r * 32768.0) as i16
        } else {
            (r * 32767.0) as i16
        };
    }
}
