pub fn multiply_into(a: &[f32], b: &[f32], out: &mut [f32]) {
    for col in 0..4 {
        let b0 = b[col * 4];
        let b1 = b[col * 4 + 1];
        let b2 = b[col * 4 + 2];
        let b3 = b[col * 4 + 3];
        out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
        out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
        out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
        out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
}
