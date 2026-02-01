import axios from 'axios';

const generateToken = async (req, _res, next) => {
  const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
  const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
  const URL =
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');

  try {
    const response = await axios(URL, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });
    req.token = response.data.access_token;
    next();
  } catch (error) {
    throw new Error(`Failed to generate access token: ${error.message}`);
  }
};

export { generateToken };